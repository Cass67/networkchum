type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: Array<{ label: string; onSelect: () => void }>;
  onClose: () => void;
};

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  if (!open) {
    return null;
  }

  return (
    <div role="menu" className="context-menu" style={{ left: x, top: y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="context-menu-item"
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
