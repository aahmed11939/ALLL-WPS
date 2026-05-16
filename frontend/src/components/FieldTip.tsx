import { useId, useState } from "react";
import { FIELD_HELP, type FieldHelpKey } from "../constants/fieldHelp";

interface FieldTipProps {
  fieldKey: FieldHelpKey;
}

export default function FieldTip({ fieldKey }: FieldTipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const entry = FIELD_HELP[fieldKey];

  if (!entry) return null;

  const toggle = () => setOpen((v) => !v);

  return (
    <span
      className="relative inline-block align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={`Help for ${entry.title}`}
        aria-expanded={open}
        aria-controls={tooltipId}
        onClick={toggle}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className="cursor-help text-slate-400 hover:text-blue-500 text-[10px] leading-none select-none ml-0.5 outline-none transition-colors"
      >
        ⓘ
      </span>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-slate-200 bg-white shadow-xl p-3.5 text-left"
          style={{ minWidth: "260px" }}
        >
          <p className="text-xs font-bold text-slate-800 mb-1 leading-snug">
            {entry.title}
          </p>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {entry.body}
          </p>
          {entry.range && (
            <p className="mt-1.5 text-[10px] text-teal-700 font-semibold">
              Range: {entry.range}
            </p>
          )}
          {entry.equation && (
            <p className="mt-1 text-[10px] font-mono text-slate-500 bg-slate-50 rounded px-1.5 py-1 leading-snug">
              {entry.equation}
            </p>
          )}
          {entry.ref && (
            <p className="mt-1.5 text-[10px] text-slate-400 font-mono border-t border-slate-100 pt-1.5">
              Ref: {entry.ref}
            </p>
          )}
        </span>
      )}
    </span>
  );
}
