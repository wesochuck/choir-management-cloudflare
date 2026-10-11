import type { ReactNode } from "react";

export interface ProfileSettingSwitchProps {
  readonly accessibleLabel?: string;
  readonly checked: boolean;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly id: string;
  readonly name?: string;
  readonly onChange: (checked: boolean) => void;
  readonly title: ReactNode;
}

export function ProfileSettingSwitch({
  accessibleLabel,
  checked,
  description,
  disabled = false,
  id,
  name,
  onChange,
  title,
}: ProfileSettingSwitchProps) {
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <label
      className={`profile-setting-row ${disabled ? "profile-setting-row--disabled" : ""}`.trim()}
      htmlFor={id}
    >
      <div className="profile-setting-row__content">
        <span className="profile-setting-row__title" id={titleId}>
          {title}
        </span>
        {description ? (
          <span className="profile-setting-row__description" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </div>
      <div className="profile-switch">
        <input
          aria-describedby={descriptionId}
          // When provided, the accessible name must contain the visible title
          // verbatim (WCAG 2.5.3 Label in Name). Otherwise fall back to the
          // visible title via labelledby.
          {...(accessibleLabel
            ? { "aria-label": accessibleLabel }
            : { "aria-labelledby": titleId })}
          checked={checked}
          className="profile-switch__input"
          disabled={disabled}
          id={id}
          name={name}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
          role="switch"
          type="checkbox"
        />
        <span aria-hidden="true" className="profile-switch__track">
          <span className="profile-switch__thumb" />
        </span>
      </div>
    </label>
  );
}
