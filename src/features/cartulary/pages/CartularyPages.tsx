import type { ReactNode } from 'react';

interface CartularyPageProps {
  active: boolean;
  children: ReactNode;
}

function CartularyPageFrame({ active, className = '', children }: CartularyPageProps & { className?: string }) {
  if (!active) return null;
  return <div className={`page-view ${className}`.trim()}>{children}</div>;
}

export function CoverPage(props: CartularyPageProps) {
  return <CartularyPageFrame {...props} className="cover-page" />;
}

export function MediaPage(props: CartularyPageProps) {
  return <CartularyPageFrame {...props} />;
}

export function ReferencePage(props: CartularyPageProps) {
  return <CartularyPageFrame {...props} />;
}

export function ConditionPage(props: CartularyPageProps) {
  return <CartularyPageFrame {...props} />;
}

export function ValuePage(props: CartularyPageProps) {
  return <CartularyPageFrame {...props} />;
}

export function PublicationPage(props: CartularyPageProps) {
  return <CartularyPageFrame {...props} className="publication-page" />;
}
