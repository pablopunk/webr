import { useState, type ReactNode } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, Search } from 'lucide-react';

export type ComposerOption = {
  value: string;
  label: string;
  shortLabel?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

export function ComposerCombobox({ label, value, options, onChange, icon, allowCustom = false, action }: {
  label: string; value: string; options: ComposerOption[]; onChange: (value: string) => void;
  icon?: ReactNode; allowCustom?: boolean; action?: { label: string; icon: ReactNode; onClick: () => void };
}) {
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.value === value) ?? { value, label: value };
  const search = query.trim();
  const items = options.filter((option) => option.label.toLowerCase().includes(search.toLowerCase()));
  const custom = allowCustom && search && !options.some((option) => option.value === search)
    ? { value: search, label: `Use “${search}”` } : null;

  return <Combobox.Root items={custom ? [...items, custom] : items} value={selected} filter={null}
    inputValue={query} onInputValueChange={setQuery} onOpenChange={() => setQuery('')}
    itemToStringLabel={(option) => option.label} isItemEqualToValue={(a, b) => a.value === b.value}
    onValueChange={(option) => { if (option && !option.disabled) onChange(option.value); }}>
    <Combobox.Trigger className="composer-select" aria-label={`${label}: ${selected.label}`} title={`${label}: ${selected.label}`}>
      <span className="composer-select-icon" aria-hidden="true">{selected.icon ?? icon}</span>
      <span className="composer-select-label">{selected.shortLabel ?? (selected.label || label)}</span>
      <ChevronDown className="composer-select-caret" size={11} aria-hidden="true" />
    </Combobox.Trigger>
    <Combobox.Portal>
      <Combobox.Positioner className="composer-select-positioner" sideOffset={6} align="start" collisionPadding={12}>
        <Combobox.Popup className="composer-select-popup" aria-label={`${label} options`}>
          <div className="composer-select-search"><Search size={14} aria-hidden="true" /><Combobox.Input aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} maxLength={allowCustom ? 120 : undefined} /></div>
          <Combobox.Empty className="composer-select-empty">No matches</Combobox.Empty>
          <Combobox.List className="composer-select-list">
            {(option: ComposerOption) => <Combobox.Item key={option.value} value={option} disabled={option.disabled} className="composer-select-option">
              {option.icon && <span aria-hidden="true">{option.icon}</span>}<span className="composer-select-option-label">{option.label}</span>
              <Combobox.ItemIndicator className="composer-select-check"><Check size={14} /></Combobox.ItemIndicator>
            </Combobox.Item>}
          </Combobox.List>
          {action && <button type="button" className="composer-select-action" onClick={action.onClick}>
            {action.icon}<span>{action.label}</span>
          </button>}
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  </Combobox.Root>;
}
