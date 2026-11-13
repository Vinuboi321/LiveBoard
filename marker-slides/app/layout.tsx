import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'LiveBoard — A little marker. A bigger conversation.', description: 'Interactive lessons built around the questions that matter. Place a marker, open a conversation, explore together.' };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}
