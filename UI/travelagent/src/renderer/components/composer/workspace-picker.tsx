import { Folder, Settings } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Workspace } from '../../../shared'

export function WorkspacePicker({
  workspaces,
  workspaceId,
  chooseWorkspace,
  manageWorkspaces,
}: {
  workspaces: Workspace[]
  workspaceId: string
  chooseWorkspace: (id: string) => void
  manageWorkspaces: () => void
}) {
  return (
    <div className="min-w-0">
      <Select
        value={workspaceId}
        disabled={!workspaces.length}
        onValueChange={(value) =>
          value === 'manage' ? manageWorkspaces() : chooseWorkspace(value)
        }
      >
        <SelectTrigger
          size="sm"
          aria-label="选择工作区"
          className="max-w-full min-w-0 gap-1.5 rounded-lg border-transparent bg-transparent px-2 text-xs shadow-none [&>span]:min-w-0 [&>span]:truncate"
        >
          <Folder aria-hidden="true" />
          <SelectValue placeholder="默认工作区" />
        </SelectTrigger>
        <SelectContent position="popper" side="top" sideOffset={4}>
          <SelectGroup>
            {workspaces.map(({ id, name }) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value="manage">
              <Settings aria-hidden="true" />
              管理工作区
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
