import type { Metadata, Viewport } from 'next';
import './globals.css';
import { LayoutShell } from '@/components/shell/LayoutShell';
import { ClientProviders } from '@/components/shell/ClientProviders';
import { getSiteSettingsServer } from '@/lib/siteStore.server';

export async function generateMetadata(): Metadata {
  const site = await getSiteSettingsServer();
  const title = site.title || 'O.home';
  const description = site.subtitle || 'O.home 커뮤니티';
  return {
    title: { default: title, template: `%s | ${title}` },
    description,
    openGraph: { title, description, siteName: title, locale: 'ko_KR', type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;d.classList.add('dark');d.style.colorScheme='dark';}catch(e){}})();`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ClientProviders>
          <LayoutShell>{children}</LayoutShell>
        </ClientProviders>
      </body>
    </html>
  );
}
