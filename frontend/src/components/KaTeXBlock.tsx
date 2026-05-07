import katex from "katex";

interface Props {
  latex: string;
  display?: boolean;
  className?: string;
}

export default function KaTeXBlock({ latex, display = false, className = "" }: Props) {
  let html: string;
  try {
    html = katex.renderToString(latex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return (
      <span className={`font-mono text-red-500 text-xs ${className}`}>
        {latex}
      </span>
    );
  }
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
