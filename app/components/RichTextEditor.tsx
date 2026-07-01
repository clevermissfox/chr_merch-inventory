import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";

// Allow style attributes on block-level elements so HTML-mode edits aren't
// silently stripped when switching back to rich text.
const PreserveStyleAttr = Extension.create({
  name: "preserveStyleAttr",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "listItem", "bulletList", "orderedList", "blockquote"],
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

const SHORT_DESC_MAX = 100;

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
      editor.commands.setContent(htmlDraft);
      onChange(htmlDraft);
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
      }),
      PreserveStyleAttr,
      Underline,
      ...(isSimple
        ? []
        : [
            Link.configure({
              openOnClick: false,
              HTMLAttributes: { rel: "noopener noreferrer" },
            }),
          ]),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    editable: !disabled,
    onUpdate({ editor }) {
      if (!editorCreated.current) return;
      const html = editor.isEmpty ? "" : editor.getHTML();
      onChange(html);
    },
  });

  // Sync value when it changes from outside (e.g. form reset)
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value ?? "");
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
    <div className={`rich-editor${disabled ? " rich-editor--disabled" : ""}${overLimit ? " rich-editor--over-limit" : ""}`}>
      <div className="rich-editor-toolbar" aria-label="Text formatting">
        <ToolbarButton
          active={editor?.isActive("bold")}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive("italic")}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive("underline")}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          title="Underline"
        >
          <UnderlineIcon size={14} />
        </ToolbarButton>
        {!isSimple && (
          <>
            <ToolbarButton
              active={editor?.isActive("strike")}
              disabled={disabled}
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              title="Strikethrough"
            >
              <Strikethrough size={14} />
            </ToolbarButton>
            <span className="rich-editor-divider" />
            <ToolbarButton
              active={editor?.isActive("bulletList")}
              disabled={disabled}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              title="Bullet list"
            >
              <List size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor?.isActive("orderedList")}
              disabled={disabled}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              title="Numbered list"
            >
              <ListOrdered size={14} />
            </ToolbarButton>
            <span className="rich-editor-divider" />
            <ToolbarButton
              active={editor?.isActive("link")}
              disabled={disabled}
              onClick={setLink}
              title="Add link"
            >
              <LinkIcon size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              disabled={disabled || !editor?.isActive("link")}
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
        <p className={`rich-editor-charcount xsmall${overLimit ? " clr-danger" : " clr-muted"}`}>
          {charCount}/{charLimit}
        </p>
      )}
    </div>
  );
}
