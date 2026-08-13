type BrandLogoVariant = 'color' | 'monochrome' | 'inverse' | 'symbol';

interface BrandLogoProps {
  className?: string;
  decorative?: boolean;
  variant?: BrandLogoVariant;
}

const LOGO_SOURCES: Record<BrandLogoVariant, string> = {
  color: '/cartularia-logo.svg',
  monochrome: '/cartularia-logo-monochrome.svg',
  inverse: '/cartularia-logo-inverse.svg',
  symbol: '/cartularia-symbol.svg',
};

export function BrandLogo({ className = '', decorative = false, variant = 'color' }: BrandLogoProps) {
  const isSymbol = variant === 'symbol';

  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src={LOGO_SOURCES[variant]}
      alt={decorative ? '' : 'Cartularia'}
      aria-hidden={decorative || undefined}
      width={isSymbol ? 240 : 980}
      height={240}
      decoding="async"
    />
  );
}
