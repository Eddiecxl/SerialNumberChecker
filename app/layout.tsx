import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'Serial Spec · CTC Device Intelligence',
  description: 'Bulk-enrich Excel device registers with CPU, RAM and serial-specific device information from HP.',
  openGraph: {
    title: 'Serial Spec · CTC Device Intelligence',
    description: 'Bulk-enrich Excel device registers with CPU, RAM and detailed HP device information.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Serial Spec · CTC Device Intelligence',
    description: 'Bulk-enrich Excel device registers with CPU, RAM and detailed HP device information.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
