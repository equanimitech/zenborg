/**
 * The first character of a name, in mono stone, standing in where the gardener
 * hasn't chosen an emoji for a person or place. Casing is kept as typed.
 */
export function InitialMark({ name }: { name: string }) {
  const initial = Array.from(name.trim())[0] ?? "";
  return (
    <span
      aria-hidden="true"
      className="font-mono font-medium text-stone-400 dark:text-stone-500"
    >
      {initial}
    </span>
  );
}
