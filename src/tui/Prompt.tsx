import { Text, useInput } from "ink";
import { useState } from "react";

/** One-line text input. onDone(undefined) means cancelled. */
export function Prompt(props: { label: string; onDone: (value: string | undefined) => void }) {
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (key.escape) return props.onDone(undefined);
    if (key.return) return props.onDone(value);
    if (key.backspace || key.delete) return setValue((v) => v.slice(0, -1));
    if (!key.ctrl && !key.meta && input) setValue((v) => v + input);
  });
  return (
    <Text>
      <Text color="cyan">{props.label}: </Text>
      {value}
      <Text inverse> </Text>
    </Text>
  );
}
