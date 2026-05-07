export interface FieldError {
  loc: string[];
  msg: string;
  type: string;
}

interface Props {
  fieldPath: string;
  errors?: FieldError[];
}

export function parseApiErrors(raw: unknown): FieldError[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.errors)) return [];
  return (r.errors as FieldError[]).filter(
    (e) => Array.isArray(e.loc) && typeof e.msg === "string"
  );
}

export default function FieldErrorHint({ fieldPath, errors = [] }: Props) {
  const match = errors.find((e) =>
    e.loc.some((part) => String(part) === fieldPath)
  );
  if (!match) return null;
  return (
    <p className="mt-1 text-xs text-rose-600 font-medium" role="alert">
      {match.msg}
    </p>
  );
}
