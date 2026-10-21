import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'MetaTrack · Clareza em cada conversão',
  icons: { icon: '/icon.svg' },
  description: 'Atribuição de vendas para Meta Ads. Conecte seus anúncios à receita real da Cakto.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
