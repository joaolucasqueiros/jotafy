import { currentWorkspace } from '@/lib/auth';
import { demoData } from '@/lib/demo';
import { Dashboard } from '@/components/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const w = await currentWorkspace();
  return (
    <Dashboard
      initial={
        w
          ? {
              ...demoData(),
              demo: false,
              workspace: w.name,
              userName: w.user_name,
              metaConnected: false,
              caktoConnected: false,
              campaigns: [],
              sales: [],
              series: [],
              summary: {
                revenue: 0,
                spend: 0,
                profit: 0,
                costs: 0,
                roas: 0,
                cpa: 0,
                sales: 0,
                refundRate: 0,
                refunded: 0,
                pending: 0,
                chargebacks: 0,
                unattributed: 0,
                attributed: 0,
                clicks: 0,
                pageviews: 0,
                checkouts: 0,
              },
              filters: { campaigns: [], adsets: [], ads: [] },
            }
          : demoData()
      }
    />
  );
}
