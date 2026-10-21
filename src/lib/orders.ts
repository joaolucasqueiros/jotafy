import { transaction } from './db';
import { canTransition, normalizeCakto } from './cakto';
export async function ingestCakto(
  workspaceId: string,
  event: NonNullable<ReturnType<typeof normalizeCakto>>,
) {
  return transaction(async (client) => {
    // Serialize lifecycle changes for the same order, including its first insert.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${workspaceId}:${event.externalId}`,
    ]);
    const receipt = await client.query(
      'INSERT INTO webhook_receipts(workspace_id,event_key,event_name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_key',
      [workspaceId, event.eventKey, event.eventName],
    );
    if (!receipt.rowCount) return { duplicate: true };
    const {
      rows: [previous],
    } = await client.query(
      'SELECT * FROM orders WHERE workspace_id=$1 AND provider=$2 AND external_id=$3',
      [workspaceId, 'cakto', event.externalId],
    );
    if (
      previous &&
      (!canTransition(previous.status, event.status) ||
        (!['refunded', 'chargeback'].includes(event.status) &&
          new Date(previous.occurred_at) > event.occurredAt))
    )
      return { ignored: true };
    const {
      rows: [click],
    } = event.clickId
      ? await client.query(
          "SELECT * FROM clicks WHERE workspace_id=$1 AND id=$2 AND created_at >= $3::timestamptz - interval '90 days' AND created_at <= $3",
          [workspaceId, event.clickId, event.occurredAt],
        )
      : { rows: [] };
    let campaignId = click?.campaign_id || event.campaignId,
      adsetId = click?.adset_id || event.adsetId,
      adId = click?.ad_id || event.adId;
    // IDs supplied by a browser or checkout are not trusted cross-tenant references.
    const {
      rows: [ad],
    } = adId
      ? await client.query('SELECT * FROM ads WHERE workspace_id=$1 AND external_id=$2', [
          workspaceId,
          adId,
        ])
      : { rows: [] };
    if (ad) {
      adId = ad.external_id;
      adsetId = ad.adset_id;
      campaignId = ad.campaign_id;
    } else adId = null;
    const {
      rows: [adset],
    } = adsetId
      ? await client.query('SELECT * FROM adsets WHERE workspace_id=$1 AND external_id=$2', [
          workspaceId,
          adsetId,
        ])
      : { rows: [] };
    if (adset) {
      adsetId = adset.external_id;
      campaignId = adset.campaign_id;
    } else adsetId = null;
    const {
      rows: [campaign],
    } = campaignId
      ? await client.query(
          'SELECT external_id FROM campaigns WHERE workspace_id=$1 AND external_id=$2',
          [workspaceId, campaignId],
        )
      : { rows: [] };
    campaignId = campaign?.external_id || null;
    const attribution = campaignId ? (click ? 'click' : 'utm') : 'unattributed';
    await client.query(
      `INSERT INTO orders(workspace_id,external_id,status,amount,currency,product,customer_hash,campaign_id,adset_id,ad_id,click_id,attribution,payment_method,occurred_at,purchased_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  ON CONFLICT(workspace_id,provider,external_id) DO UPDATE SET status=$3,amount=$4,product=$6,customer_hash=COALESCE($7,orders.customer_hash),campaign_id=COALESCE($8,orders.campaign_id),adset_id=COALESCE($9,orders.adset_id),ad_id=COALESCE($10,orders.ad_id),click_id=COALESCE($11,orders.click_id),attribution=CASE WHEN $8 IS NOT NULL THEN $12 ELSE orders.attribution END,occurred_at=$14,purchased_at=COALESCE(orders.purchased_at,$15),updated_at=now()`,
      [
        workspaceId,
        event.externalId,
        event.status,
        event.amount,
        event.currency,
        event.product,
        event.customerHash,
        campaignId,
        adsetId,
        adId,
        click?.id || null,
        attribution,
        event.paymentMethod,
        event.occurredAt,
        event.status === 'approved' ? event.occurredAt : null,
      ],
    );
    if (event.status === 'approved' && previous?.status !== 'approved') {
      const eventId = `cakto:${event.externalId}:purchase`;
      await client.query(
        `INSERT INTO jobs(workspace_id,kind,dedupe_key,payload) VALUES($1,'capi',$2,$3) ON CONFLICT DO NOTHING`,
        [
          workspaceId,
          eventId,
          JSON.stringify({
            event_name: 'Purchase',
            event_id: eventId,
            event_time: Math.floor(event.occurredAt.getTime() / 1000),
            action_source: 'website',
            event_source_url: click?.landing_url,
            user_data: {
              ...(click?.user_agent ? { client_user_agent: click.user_agent } : {}),
              ...(event.customerHash ? { em: [event.customerHash] } : {}),
              ...(click?.fbc ? { fbc: click.fbc } : {}),
              ...(click?.fbp ? { fbp: click.fbp } : {}),
            },
            custom_data: {
              currency: event.currency,
              value: event.amount / 100,
              order_id: event.externalId,
            },
          }),
        ],
      );
    }
    return { accepted: true, attribution };
  });
}
