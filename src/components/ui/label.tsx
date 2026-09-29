import { cn } from "@/lib/utils";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-300",
        className,
      )}
      {...props}
    />
  );
}
