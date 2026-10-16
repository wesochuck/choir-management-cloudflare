import { TabsList, TabsTrigger } from "@choir/ui";
import type { MusicEditorTab } from "./utils";

export function MusicEditorNav({
  value,
  onChange,
  saved,
  isMovement,
  movementCount,
}: {
  readonly value: MusicEditorTab;
  readonly onChange: (tab: MusicEditorTab) => void;
  readonly saved: boolean;
  readonly isMovement: boolean;
  readonly movementCount: number;
}) {
  const sections: {
    readonly id: MusicEditorTab;
    readonly label: string;
    readonly disabled: boolean;
  }[] = [
    { id: "details", label: "Piece details", disabled: false },
    ...(!isMovement && saved
      ? [
          {
            id: "movements" as const,
            label: `Movements (${String(movementCount)})`,
            disabled: false,
          },
        ]
      : []),
    { id: "tracks", label: "Practice tracks", disabled: !saved },
    { id: "scores", label: "Digital scores", disabled: !saved },
    { id: "performances", label: "Linked performances", disabled: !saved },
  ];
  return (
    <>
      <label className="field music-editor-mobile-nav">
        Music section
        <select
          value={value}
          onChange={(event) => {
            const section = sections.find(({ id }) => id === event.target.value);
            if (section && !section.disabled) onChange(section.id);
          }}
        >
          {sections.map(({ id, label, disabled }) => (
            <option disabled={disabled} key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <aside className="music-editor-rail" aria-label="Music section navigation">
        <TabsList aria-label="Music piece editor" className="music-editor-rail__tabs">
          {sections.map(({ id, label, disabled }) => (
            <TabsTrigger
              aria-controls={`music-piece-${id}`}
              className="music-editor-rail__tab"
              disabled={disabled}
              id={`music-piece-${id}-tab`}
              key={id}
              value={id}
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </aside>
    </>
  );
}
