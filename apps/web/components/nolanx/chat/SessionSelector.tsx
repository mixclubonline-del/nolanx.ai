import { Session } from '@/lib/nolanx/types/types'
import { PlusIcon } from 'lucide-react'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'
import { Button } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'

type SessionSelectorProps = {
  session: Session | null
  sessionList: Session[]
  onSelectSession: (sessionId: string) => void
  onClickNewChat: () => void
  isShared?: boolean
}

const SessionSelector: React.FC<SessionSelectorProps> = ({
  session,
  sessionList,
  onSelectSession,
  onClickNewChat,
  isShared = false,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-2 w-full">
      <Select
        value={session?.id}
        onValueChange={(value) => {
          onSelectSession(value)
        }}
      >
        <SelectTrigger className="flex-1 min-w-0 bg-background">
          <SelectValue placeholder={t('chat:sessionSelector.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {sessionList?.map((session) => (
            <SelectItem key={session.id} value={session.id}>
              {session.title.replace(/\!\[.+](.+)/g, '')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant={'outline'}
        onClick={onClickNewChat}
        className="shrink-0 gap-1"
      >
        <PlusIcon />
        <span className="text-sm">{t('chat:newChat')}</span>
      </Button>
    </div>
  )
}

export default SessionSelector
