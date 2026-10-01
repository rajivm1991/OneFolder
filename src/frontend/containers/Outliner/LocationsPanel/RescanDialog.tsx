import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';

import { Button, Checkbox, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import { FileDTO } from '../../../../api/file';
import { ID } from '../../../../api/id';

export interface RescanResult {
  folderName: string;
  folderPath: string;
  checked: number;
  missing: FileDTO[];
}

interface RescanDialogProps {
  result: RescanResult;
  onRemove: (ids: ID[]) => Promise<void>;
  onClose: () => void;
}

const RescanDialog = ({ result, onRemove, onClose }: RescanDialogProps) => {
  const { folderName, folderPath, checked, missing } = result;
  // All missing entries are selected by default, the user can untick the ones to keep
  const [selected, setSelected] = useState<Set<ID>>(() => new Set(missing.map((f) => f.id)));
  const [isRemoving, setIsRemoving] = useState(false);

  const toggle = (id: ID, value: boolean) => {
    const next = new Set(selected);
    if (value) {
      next.add(id);
    } else {
      next.delete(id);
    }
    setSelected(next);
  };

  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      await onRemove(Array.from(selected));
    } finally {
      onClose();
    }
  };

  return (
    <Dialog
      open
      title={`Re-scan "${folderName}"`}
      icon={IconSet.RELOAD_COMPACT}
      describedby="rescan-info"
      onCancel={onClose}
    >
      <div id="rescan-info">
        <p>
          Checked {checked} file{checked !== 1 ? 's' : ''} in this folder:{' '}
          {checked - missing.length} still on disk, {missing.length} missing.
        </p>
        {missing.length === 0 ? (
          <p>No dead entries, nothing to clean up.</p>
        ) : (
          <>
            <p>
              Selected entries are removed from OneFolder (their tags and face data are lost). Files
              on disk are never touched. Untick the ones you want to keep.
            </p>
            <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
              {missing.map((f) => (
                <div key={f.id}>
                  <Checkbox checked={selected.has(f.id)} onChange={(v) => toggle(f.id, v)}>
                    {f.absolutePath.startsWith(folderPath)
                      ? f.absolutePath.slice(folderPath.length + 1)
                      : f.absolutePath}
                  </Checkbox>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="dialog-actions">
        {missing.length > 0 && (
          <Button
            styling="filled"
            onClick={handleRemove}
            disabled={selected.size === 0 || isRemoving}
            text={`Remove ${selected.size} from library`}
          />
        )}
        <Button
          styling={missing.length > 0 ? 'outlined' : 'filled'}
          onClick={onClose}
          text={missing.length > 0 ? 'Keep all' : 'Close'}
        />
      </div>
    </Dialog>
  );
};

export default observer(RescanDialog);
