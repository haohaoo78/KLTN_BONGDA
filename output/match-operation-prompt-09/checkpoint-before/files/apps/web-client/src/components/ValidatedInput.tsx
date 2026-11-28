import { InputHTMLAttributes, useEffect, useId, useState } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  validate?: (value: string) => string | undefined;
  serverError?: string;
};

function messageFor(input: HTMLInputElement, value: string, custom?: (value: string) => string | undefined): string | undefined {
  const customMessage = custom?.(value);
  if (customMessage) return customMessage;
  if (input.validity.valueMissing) return "Vui lòng nhập thông tin này.";
  if (input.validity.typeMismatch && input.type === "email") return "Địa chỉ email không hợp lệ.";
  if (input.validity.tooShort) return `Cần nhập ít nhất ${input.minLength} ký tự.`;
  if (input.validity.tooLong) return `Không được vượt quá ${input.maxLength} ký tự.`;
  if (input.validity.rangeUnderflow || input.validity.rangeOverflow) return "Giá trị nằm ngoài phạm vi cho phép.";
  if (input.validity.badInput) return "Định dạng dữ liệu không hợp lệ.";
  return undefined;
}

export function ValidatedInput({ label, value, onChange, validate, serverError, id, onBlur, onInvalid, ...inputProps }: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const [touched, setTouched] = useState(false);
  const [validationError, setValidationError] = useState<string>();
  const error = serverError || (touched ? validationError : undefined);

  useEffect(() => {
    if (!touched) return;
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) setValidationError(messageFor(input, value, validate));
  }, [inputId, touched, validate, value]);

  function updateError(input: HTMLInputElement) {
    setValidationError(messageFor(input, input.value, validate));
  }

  return <label className={`field validated-field ${error ? "has-error" : ""}`} htmlFor={inputId}>
    <span>{label}</span>
    <input
      {...inputProps}
      id={inputId}
      value={value}
      onChange={(event) => { onChange(event.target.value); if (touched) updateError(event.currentTarget); }}
      onBlur={(event) => { setTouched(true); updateError(event.currentTarget); onBlur?.(event); }}
      onInvalid={(event) => { event.preventDefault(); setTouched(true); updateError(event.currentTarget); onInvalid?.(event); }}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? errorId : undefined}
    />
    {error ? <small className="field-validation-error" id={errorId} role="alert">{error}</small> : null}
  </label>;
}
