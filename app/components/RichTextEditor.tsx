import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

// Allow style attributes on block-level elements so HTML-mode edits aren't
// silently stripped when switching back to rich text.
const PreserveStyleAttr = Extension.create({
  name: "preserveStyleAttr",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "listItem",
          "bulletList",
          "orderedList",
          "blockquote",
        ],
        attributes: {
          style: {
            default: null,
            parseHTML: (el) => el.getAttribute("style") || null,
            renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
          },
        },
      },
    ];
  },
});
import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  Link2Off,
  List,
  ListOrdered,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";

const SHORT_DESC_MAX = 150;

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  onOverLimit?: (isOver: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  variant?: "full" | "simple";
  maxChars?: number;
}

function ToolbarButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={`rich-editor-btn${active ? " is-active" : ""}`}
    >
      {children}
    </button>
  );
}

// TipTap trims leading/trailing whitespace inside a block when it re-parses
// stored HTML (e.g. "<p>Text! </p>" -> "<p>Text!</p>") — a real, unavoidable
// normalization, not a bug. If we save the untrimmed version, the very next
// time this content loads it "changes" on its own with zero user input,
// tripping the edit dialog's dirty-check. Trimming here, at the source, so
// what's saved already matches what TipTap will reproduce on its own.
function normalizeHtml(html: string): string {
  return html
    .replace(/(<(?:p|li|h[1-6]|blockquote)(?:\s[^>]*)?>)\s+/gi, "$1")
    .replace(/\s+(<\/(?:p|li|h[1-6]|blockquote)>)/gi, "$1");
}

export default function RichTextEditor({
  value,
  onChange,
  onOverLimit,
  disabled = false,
  placeholder,
  variant = "full",
  maxChars,
}: RichTextEditorProps) {
  const isSimple = variant === "simple";
  const charLimit = maxChars ?? SHORT_DESC_MAX;
  const editorCreated = useRef(false);
  const [showHtml, setShowHtml] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState("");

  const toggleHtml = () => {
    if (!editor) return;
    if (!showHtml) {
      // Snapshot the current HTML into local state — don't let TipTap parse on
      // every keystroke while the user edits raw markup
      setHtmlDraft(editor.isEmpty ? "" : editor.getHTML());
      setShowHtml(true);
    } else {
      // Apply whatever the user typed back to the editor
      const normalized = normalizeHtml(htmlDraft);
      editor.commands.setContent(normalized);
      onChange(normalized);
      setShowHtml(false);
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable block-level formatting for simple variant
        heading: isSimple ? false : { levels: [2, 3] },
        bulletList: isSimple ? false : {},
        orderedList: isSimple ? false : {},
        blockquote: isSimple ? false : {},
        horizontalRule: false,
        codeBlock: false,
        code: false,
        // StarterKit bundles Link and Underline itself (as of v3) — configuring
        // them here instead of adding separate instances avoids the
        // "Duplicate extension names" warning, which came with two competing
        // registrations resolving unpredictably.
        //
        // Always enabled, even for the "simple" variant (no toolbar button
        // to add one — see `!isSimple` below) — some variant/short
        // descriptions already contain a real <a href> (e.g. crediting an
        // artist's site), and disabling the mark entirely doesn't just hide
        // the toolbar button, it makes the schema unable to represent a link
        // at all: TipTap silently drops the <a> tag (keeping only its text)
        // the moment it parses stored content that has one, destroying the
        // link on every load.
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: "noopener noreferrer" },
        },
      }),
      PreserveStyleAttr,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    editable: !disabled,
    onUpdate({ editor }) {
      if (!editorCreated.current) return;
      const html = editor.isEmpty ? "" : normalizeHtml(editor.getHTML());
      onChange(html);
    },
  });

  // editor.isActive(...) read directly at render time only reflects
  // whatever it was at the last render — nothing re-renders this component
  // on a pure selection/cursor move (no doc change), so toolbar buttons went
  // stale the instant you clicked somewhere without also editing. This hook
  // re-renders specifically when the computed selector result changes,
  // including on selection-only changes.
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      underline: editor?.isActive("underline") ?? false,
      strike: editor?.isActive("strike") ?? false,
      bulletList: editor?.isActive("bulletList") ?? false,
      orderedList: editor?.isActive("orderedList") ?? false,
      link: editor?.isActive("link") ?? false,
    }),
  });

  // Sync value when it changes from outside (e.g. form reset). Explicitly
  // silent (emitUpdate: false) — this call must never fire onUpdate itself,
  // regardless of whether TipTap's reserialized HTML differs slightly from
  // the raw stored string (quote style, whitespace, etc.). Relying on
  // editor.isFocused to distinguish "programmatic" from "real" updates was
  // unreliable: clicking a toolbar button re-focuses the editor via a
  // command chain, and there's a race where isFocused can still read false
  // for that same command's update — silently swallowing genuine formatting
  // changes (bold/italic toggles) along with the mount-time resync.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value ?? "", { emitUpdate: false });
    }
  }, [value, editor]);

  // Mark editor as initialized after first content sync runs (must come after [value, editor] effect)
  useEffect(() => {
    if (editor) editorCreated.current = true;
  }, [editor]);

  // Sync disabled state
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  const charCount = editor?.getText().length ?? 0;
  const overLimit = isSimple && charCount > charLimit;

  useEffect(() => {
    onOverLimit?.(overLimit);
  }, [overLimit]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (!url) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <div
      className={`rich-editor${disabled ? " rich-editor--disabled" : ""}${overLimit ? " rich-editor--over-limit" : ""}`}
    >
      <div className="rich-editor-toolbar" aria-label="Text formatting">
        <ToolbarButton
          active={toolbarState.bold}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.italic}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.underline}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          title="Underline"
        >
          <UnderlineIcon size={14} />
        </ToolbarButton>
        {!isSimple && (
          <>
            <ToolbarButton
              active={toolbarState.strike}
              disabled={disabled}
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              title="Strikethrough"
            >
              <Strikethrough size={14} />
            </ToolbarButton>
            <span className="rich-editor-divider" />
            <ToolbarButton
              active={toolbarState.bulletList}
              disabled={disabled}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              title="Bullet list"
            >
              <List size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={toolbarState.orderedList}
              disabled={disabled}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              title="Numbered list"
            >
              <ListOrdered size={14} />
            </ToolbarButton>
            <span className="rich-editor-divider" />
            <ToolbarButton
              active={toolbarState.link}
              disabled={disabled}
              onClick={setLink}
              title="Add link"
            >
              <LinkIcon size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              disabled={disabled || !toolbarState.link}
              onClick={() => editor?.chain().focus().unsetLink().run()}
              title="Remove link"
            >
              <Link2Off size={14} />
            </ToolbarButton>
          </>
        )}

        <span className="rich-editor-divider margin-is-auto" />
        <ToolbarButton
          active={showHtml}
          disabled={disabled}
          onClick={toggleHtml}
          title={showHtml ? "Back to rich text" : "Edit raw HTML"}
        >
          <Code size={14} />
        </ToolbarButton>
      </div>

      {showHtml ? (
        <textarea
          className="rich-editor-content rich-editor-html"
          value={htmlDraft}
          onChange={(e) => setHtmlDraft(e.target.value)}
          disabled={disabled}
          spellCheck={false}
        />
      ) : (
        <EditorContent className="rich-editor-content" editor={editor} />
      )}

      {isSimple && (
        <p
          className={`rich-editor-charcount xsmall${overLimit ? " clr-danger" : " clr-muted"}`}
        >
          {charCount}/{charLimit}
        </p>
      )}
    </div>
  );
}
