import { useEffect, useMemo, useState } from "react";
import { getInstitutions, type Institution } from "../api/institutions";

type Props = {
  label: string;
  value: string;
  onChange: (institutionId: string) => void;
  required?: boolean;
  disabled?: boolean;
};

export function InstitutionSelector({ label, value, onChange, required = false, disabled = false }: Props) {
  const [search, setSearch] = useState("");
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      getInstitutions({ search: search.trim() || undefined })
        .then(({ institutions: result }) => { if (active) setInstitutions(result); })
        .catch((loadError: unknown) => {
          if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được danh mục trường.");
        })
        .finally(() => { if (active) setLoading(false); });
    }, search.trim() ? 220 : 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [search]);

  const selected = institutions.find((institution) => institution.id === value);
  const visibleInstitutions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi-VN");
    const matches = query
      ? institutions.filter((institution) => [institution.name, institution.shortName, institution.code, institution.admissionCode]
        .some((field) => field?.toLocaleLowerCase("vi-VN").includes(query)))
      : institutions;
    return matches.slice(0, 8);
  }, [institutions, search]);
  const inputValue = focused ? search : selected?.name ?? search;

  function chooseInstitution(institution: Institution) {
    onChange(institution.id);
    setSearch(institution.name);
    setFocused(false);
  }

  return (
    <div className="institution-selector institution-autocomplete">
      <label className="field institution-autocomplete-field">
        {label}{required ? <span className="required-mark"> *</span> : null}
        <span className="institution-autocomplete-control">
          <input
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={focused && !disabled}
            aria-controls="institution-suggestions"
            aria-invalid={required && !value ? "true" : undefined}
            value={inputValue}
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            onFocus={() => { setSearch(selected?.name ?? search); setFocused(true); }}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              setSearch(event.target.value);
              if (value) onChange("");
              setFocused(true);
            }}
            placeholder="Gõ tên trường, tên viết tắt hoặc mã trường"
          />
          <span className="institution-autocomplete-indicator" aria-hidden="true">⌕</span>
          {focused && !disabled ? (
            <div className="institution-suggestions" id="institution-suggestions" role="listbox" aria-label="Gợi ý trường học">
              {loading ? <div className="institution-suggestion-message">Đang tìm trường…</div> : null}
              {!loading && error ? <div className="institution-suggestion-message is-error">{error}</div> : null}
              {!loading && !error && visibleInstitutions.length ? visibleInstitutions.map((institution) => (
                <button
                  className="institution-suggestion"
                  id={`institution-option-${institution.id}`}
                  key={institution.id}
                  type="button"
                  role="option"
                  aria-selected={institution.id === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseInstitution(institution)}
                >
                  <span className="institution-suggestion-icon" aria-hidden="true">⌂</span>
                  <span><strong>{institution.name}</strong><small>{[institution.shortName, institution.code ?? institution.admissionCode].filter(Boolean).join(" · ") || "Cơ sở giáo dục"}</small></span>
                  {institution.id === value ? <b aria-hidden="true">✓</b> : null}
                </button>
              )) : null}
              {!loading && !error && visibleInstitutions.length === 0 ? <div className="institution-suggestion-message">Không tìm thấy trường phù hợp.</div> : null}
            </div>
          ) : null}
        </span>
        <small className="institution-selected-hint">{selected ? `Đã chọn: ${selected.name}` : required ? "Chọn một trường trong danh sách gợi ý." : ""}</small>
      </label>
    </div>
  );
}
