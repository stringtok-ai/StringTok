'use client';

import { usePathname } from 'next/navigation';
import { MainLayout } from '@/components/layout';

export default function MainGroupLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The home page (/) gets the full-screen video layout (no sidebar/footer)
  if (pathname === '/') {
    return <div className="video-layout">{children}</div>;
  }

  // Other pages keep the traditional layout
  return <MainLayout>{children}</MainLayout>;
}
