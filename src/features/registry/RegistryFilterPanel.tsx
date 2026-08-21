import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

export function RegistryFilterPanel({
  className,
  label = 'Filtres',
  activeFilterCount,
  children,
}: {
  className: string;
  label?: string;
  activeFilterCount: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <section className={`${className} registry-filter-panel`} aria-label={label}>
      <button
        type="button"
        className="registry-filter-title registry-filter-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <SlidersHorizontal aria-hidden="true" />
        <span>{label}</span>
        {activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
        <span className="registry-filter-toggle__action">{expanded ? 'Replier' : 'Déplier'}</span>
        <ChevronDown className="registry-filter-toggle__chevron" aria-hidden="true" />
      </button>
      <div id={contentId} className="registry-filter-panel__content" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
