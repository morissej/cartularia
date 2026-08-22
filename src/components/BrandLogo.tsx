type BrandLogoVariant = 'color' | 'monochrome' | 'inverse' | 'symbol';

interface BrandLogoProps {
  className?: string;
  decorative?: boolean;
  href?: string;
  variant?: BrandLogoVariant;
}

const LOGO_SOURCES: Record<BrandLogoVariant, string> = {
  color: '/cartularia-logo.svg',
  monochrome: '/cartularia-logo-monochrome.svg',
  inverse: '/cartularia-logo-inverse.svg',
  symbol: '/cartularia-symbol.svg',
};

export function BrandLogo({ className = '', decorative = false, href = '/registry', variant = 'color' }: BrandLogoProps) {
  const isSymbol = variant === 'symbol';
  const image = (
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

  if (decorative || !href) {
    return image;
  }

  return (
    <a className="brand-logo-link" href={href} aria-label="Ouvrir le Registre Cartularia">
      {image}
    </a>
  );
}
