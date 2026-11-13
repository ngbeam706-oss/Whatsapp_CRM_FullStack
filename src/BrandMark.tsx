import { MessageCircle } from 'lucide-react';
import { useBranding } from './branding';

/**
 * The application's logo (from the Platform Admin's Branding tab) or, without one, the chat icon.
 * size: the box in pixels; tone: the icon box colour when there is no logo.
 */
export function BrandLogo({ size = 32, tone = 'bg-emerald-600' }: { size?: number; tone?: string }) {
  const b = useBranding();
  if (b.logoUrl) {
    return <img src={b.logoUrl} alt={`${b.brandName} logo`} width={size} height={size} className="rounded-lg object-contain bg-white flex-shrink-0" style={{ width: size, height: size }} data-testid="brand-logo" />;
  }
  return (
    <span className={`rounded-lg ${tone} text-white flex items-center justify-center flex-shrink-0`} style={{ width: size, height: size }} aria-hidden="true">
      <MessageCircle style={{ width: size * 0.6, height: size * 0.6 }} />
    </span>
  );
}

/** The app's name (placeholders like "[Your Brand]" are hidden behind a neutral name where it would look broken). */
export function useBrandName(fallback = 'WhatsApp CRM') {
  const b = useBranding();
  return /^\[.*\]$/.test(b.brandName) ? fallback : b.brandName;
}
