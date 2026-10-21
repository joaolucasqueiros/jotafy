import Link from 'next/link';
import { Activity, ArrowLeft } from 'lucide-react';
export default function Guide() {
  return (
    <article className="guide-page">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <Activity size={22} />
        </span>
        <span>
          meta<span className="brand-light">track</span>
          <span className="brand-dot">.</span>
        </span>
      </Link>
      <Link href="/" className="text-button">
        <ArrowLeft size={14} />
        Voltar ao dashboard
      </Link>
      <h1 style={{ marginTop: 25 }}>Da configuração à primeira venda.</h1>
      <p>
        MetaTrack 1.0 integra Meta Ads e Cakto. O repositório inclui as instruções completas no
        README e o contrato de integração em docs/integrations.md.
      </p>
      <h2>1. Prepare o ambiente</h2>
      <pre>{`cp .env.example .env.local\n# Preencha ENCRYPTION_KEY: openssl rand -base64 32\ndocker compose up -d db\nnpm ci\nnpm run db:migrate\nnpm run dev\n# Em outro terminal:\nnpm run worker`}</pre>
      <p>
        Em produção, use PostgreSQL gerenciado com TLS e backups, APP_URL em HTTPS, npm run build e
        npm start. Rode o worker como um serviço separado. Não publique o banco de desenvolvimento
        na Internet.
      </p>
      <h2>2. Conecte a Meta</h2>
      <ol>
        <li>
          Crie um aplicativo Meta Business e configure META_APP_ID, META_APP_SECRET e
          META_GRAPH_VERSION.
        </li>
        <li>
          Cadastre o callback APP_URL/api/auth/meta/callback como URI válida do Facebook Login.
        </li>
        <li>
          Para contas de terceiros, complete a verificação de negócio e a revisão de ads_read e
          ads_management exigidas pela Meta. O modo de desenvolvimento limita acesso aos papéis
          autorizados do aplicativo.
        </li>
        <li>
          Entre no MetaTrack, abra Integrações e conecte a Meta. Selecione contas BRL no fuso
          America/Sao_Paulo.
        </li>
        <li>
          Inicie o worker e solicite a sincronização. São importados campanhas, conjuntos, anúncios
          e 90 dias de investimento diário.
        </li>
      </ol>
      <h2>3. Configure a Cakto</h2>
      <ol>
        <li>Em Integrações, gere um segredo e copie a URL exclusiva do seu workspace.</li>
        <li>
          No painel da Cakto, configure a URL, o mesmo segredo e os eventos aprovados, pendentes,
          reembolsados e chargebacks.
        </li>
        <li>
          Valide o payload com docs/integrations.md antes de operar. Nomes de campos e eventos do
          provedor precisam corresponder ao contrato implementado.
        </li>
        <li>
          Confirme que as UTMs retornam no webhook. A aplicação usa IDs: utm_campaign → campanha,
          utm_term → conjunto e utm_content → anúncio.
        </li>
      </ol>
      <h2>4. Instale o pixel e a CAPI</h2>
      <p>
        Adicione as origens HTTPS do seu site, o ID do Pixel/Dataset e o token da Conversions API.
        Copie o código em Rastreamento e invoque a inicialização apenas após o consentimento.
        Preserve UTMs ao direcionar para o checkout com MetaTrack.decorateCheckout(url).
      </p>
      <p>
        O evento Purchase é enviado à CAPI apenas após confirmação do webhook; eventos Purchase do
        navegador não criam vendas. Use o código de Test Events da Meta na homologação e remova-o
        antes da operação real. Eventos sem identificador de correspondência não são declarados
        entregues.
      </p>
      <h2>Como ler as métricas</h2>
      <ul>
        <li>
          Faturamento: soma dos pedidos atualmente aprovados, pela data de aprovação no fuso de São
          Paulo.
        </li>
        <li>ROAS: faturamento aprovado dividido pelo investimento.</li>
        <li>CPA: investimento dividido pelo número de pedidos aprovados.</li>
        <li>
          Lucro líquido estimado: faturamento aprovado menos anúncios e custos médios definidos em
          Configurações. É uma estimativa; despesas fixas não são distribuídas nos filtros de
          campanha.
        </li>
        <li>
          Reembolsos e chargebacks reclassificam o pedido original. Não são lançamentos contábeis na
          data do estorno.
        </li>
        <li>
          Vendas sem identificadores válidos aparecem sem atribuição; o sistema não inventa uma
          campanha.
        </li>
      </ul>
      <h2>O que precisa de homologação real</h2>
      <p>
        Login OAuth, permissões Meta, envio aceito pela CAPI e o payload efetivo da Cakto dependem
        de credenciais, configuração e conta real. O teste local usa payloads contratuais e não
        comprova a entrega a esses serviços. Server-side tracking melhora a cobertura; não garante
        recuperação de todas as conversões e não dispensa consentimento.
      </p>
      <h2>Privacidade e segurança</h2>
      <p>
        Segredos são criptografados com AES-256-GCM. Senhas usam scrypt. Sessões possuem cookies
        HttpOnly. Os webhooks são deduplicados no banco, e todas as consultas de negócio são
        limitadas ao workspace autenticado. Cliques expiram após 90 dias; dados de correspondência
        em jobs concluídos são removidos após 7 dias. Configure uma política de privacidade,
        atendimento a titulares e retenção contábil adequados antes do lançamento público.
      </p>
    </article>
  );
}
