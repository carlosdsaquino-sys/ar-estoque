import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  noResultsText?: string;
};

type MenuPosition = { left: number; top: number; width: number; maxHeight: number };

export function SearchableSelect({
  value, options, onChange, placeholder = 'Selecione...', label, disabled = false,
  required = false, className = '', noResultsText = 'Nenhum resultado encontrado.',
}: SearchableSelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selected = options.find(option => option.value === value);
  const filteredOptions = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return options.filter(option => !term || option.label.toLocaleLowerCase().includes(term));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const placeAbove = below < Math.min(240, above) && above > below;
      const maxHeight = Math.max(120, Math.min(240, placeAbove ? above : below));
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        top: placeAbove ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
        width: rect.width,
        maxHeight,
      });
    };
    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !document.getElementById(`${id}-listbox`)?.contains(target)) {
        setOpen(false);
        setQuery('');
      }
    };
    updatePosition();
    document.addEventListener('pointerdown', closeIfOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [id, open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(index => Math.min(index, Math.max(0, filteredOptions.length - 1)));
  }, [filteredOptions.length, open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function openMenu() {
    if (disabled) return;
    setQuery('');
    setActiveIndex(Math.max(0, filteredOptions.findIndex(option => option.value === value)));
    setOpen(true);
  }

  function choose(option: SearchableSelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      else if (filteredOptions.length) {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex(index => (index + delta + filteredOptions.length) % filteredOptions.length);
      }
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = filteredOptions[activeIndex];
      if (option) choose(option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery('');
    } else if (event.key === 'Tab' && open) {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      {label && <label htmlFor={`${id}-input`} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>}
      <div className="relative">
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={`${id}-listbox`}
          aria-activedescendant={open && filteredOptions[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={open ? query : selected?.label ?? ''}
          placeholder={placeholder}
          onFocus={openMenu}
          onClick={() => { if (!open) openMenu(); }}
          onChange={event => { setQuery(event.target.value); setActiveIndex(0); if (!open) setOpen(true); }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-9 text-sm text-slate-900 outline-none transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Fechar opções' : 'Abrir opções'}
          disabled={disabled}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { if (open) { setOpen(false); setQuery(''); } else { openMenu(); inputRef.current?.focus(); } }}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>
      {open && position && createPortal(
        <div
          id={`${id}-listbox`}
          role="listbox"
          aria-label={label ?? placeholder}
          className="fixed z-[110] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
        >
          {filteredOptions.length ? filteredOptions.map((option, index) => (
            <button
              ref={element => { optionRefs.current[index] = element; }}
              id={`${id}-option-${index}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(option)}
              className={`block w-full px-3 py-2 text-left text-sm ${option.value === value ? 'bg-sky-50 font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' : 'text-slate-700 dark:text-slate-100'} ${index === activeIndex ? 'bg-slate-100 dark:bg-slate-700' : ''} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {option.label}
            </button>
          )) : <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">{noResultsText}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
