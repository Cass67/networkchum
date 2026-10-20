import { useEffect, useRef } from "react";

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: Array<{ label: string; onSelect: () => void; danger?: boolean }>;
  onClose: () => void;
};

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      onClose();
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      className="context-menu"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`context-menu-item${item.danger ? " is-danger" : ""}`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
