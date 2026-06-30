import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import RefAddNew, { type RefAddType, type RefAddedEntry } from "./RefAddNew";

interface FormGroupRefProps {
  label: ReactNode;
  htmlFor: string;
  hasRequired?: boolean;
  /** Extra elements in the label row, e.g. a CircleQuestionMark help button */
  labelActions?: ReactNode;
  /** Rendered below the input/children */
  hint?: ReactNode;
  // RefAddNew config — omit refType for a plain form-group with no add-new button
  refType?: RefAddType;
  existingValues?: string[];
  existingCodes?: string[];
  onAdded?: (entry: RefAddedEntry) => void;
  parentWooId?: number | null;
  parentCode?: string | null;
  parentDisplayName?: string;
  /** Called when the add-new form opens or closes */
  onExpandedChange?: (expanded: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}

export default function FormGroupRef({
  label,
  htmlFor,
  hasRequired,
  labelActions,
  hint,
  refType,
  existingValues,
  existingCodes,
  onAdded,
  parentWooId,
  parentCode,
  parentDisplayName,
  onExpandedChange,
  disabled,
  children,
}: FormGroupRefProps) {
  const [expanded, setExpanded] = useState(false);

  const handleExpandedChange = (next: boolean) => {
    setExpanded(next);
    onExpandedChange?.(next);
  };

  const subcatMissingParent = refType === "subcategory" && !parentCode?.trim();
  const triggerDisabled = disabled || subcatMissingParent;
  const triggerTitle = subcatMissingParent
    ? "Select a category before adding a subcategory"
    : undefined;

  const labelRow = (
    <div className="row ai-cen gap-1">
      {labelActions ? (
        <div className="row ai-cen gap-half">
          <label htmlFor={htmlFor} className="bold" data-required={hasRequired}>
            {label}
          </label>
          {labelActions}
        </div>
      ) : (
        <label htmlFor={htmlFor} className="bold" data-required={hasRequired}>
          {label}
        </label>
      )}
      {refType && !expanded && (
        <button
          type="button"
          className="ref-add__trigger btn-ghost margin-is-auto row gap-quarter ai-cen"
          onClick={() => handleExpandedChange(true)}
          disabled={triggerDisabled}
          title={triggerTitle}
          aria-expanded={false}
        >
          <Plus aria-hidden="true" />
          <span>Add new</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="form-group">
      {labelRow}
      {children}
      {hint}
      {expanded && refType && (
        <RefAddNew
          startExpanded
          refType={refType}
          existingValues={existingValues ?? []}
          existingCodes={existingCodes ?? []}
          onAdded={(entry) => {
            onAdded?.(entry);
          }}
          parentWooId={parentWooId}
          parentCode={parentCode}
          parentDisplayName={parentDisplayName}
          onExpandedChange={(v) => {
            if (!v) handleExpandedChange(false);
          }}
          disabled={disabled}
        />
      )}
    </div>
  );
}
