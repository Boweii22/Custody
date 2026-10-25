import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
    title: 'Custody — Every dollar knows who asked for it.',
    description: 'An intelligent back office with a deterministic conscience. Trace every decision, protect every payment, and try to break the rules.',
    icons: { icon: '/icon.svg' },
    manifest: '/manifest.webmanifest',
};
export default function RootLayout({ children }: Readonly<{
    children: React.ReactNode;
}>) {
    return <html lang="en"><body>{children}</body></html>;
}
