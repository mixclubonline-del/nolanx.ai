import CommonDialogContent from '../common/DialogContent'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { useTranslation } from '@/lib/nolanx/i18n/useTranslation'

type CanvasDeleteDialogProps = {
  show: boolean
  className?: string
  children?: React.ReactNode
  setShow: (show: boolean) => void
  handleDeleteCanvas: () => void
  deleting?: boolean
}

const CanvasDeleteDialog: React.FC<CanvasDeleteDialogProps> = ({
  show,
  setShow,
  handleDeleteCanvas,
  deleting = false,
}) => {
  const { t } = useTranslation()

  return (
    <Dialog open={show} onOpenChange={setShow}>

      <CommonDialogContent open={show}>
        <DialogHeader>
          <DialogTitle>{t('canvas:deleteDialog.title')}</DialogTitle>
        </DialogHeader>

        <DialogDescription>
          {t('canvas:deleteDialog.description')}
        </DialogDescription>

        <DialogFooter>
          <Button variant="outline" onClick={() => setShow(false)} disabled={deleting}>
            {t('canvas:deleteDialog.cancel')}
          </Button>
          <Button variant="secondary" onClick={() => handleDeleteCanvas()} disabled={deleting}>
            {deleting ? 'Deleting...' : t('canvas:deleteDialog.delete')}
          </Button>
        </DialogFooter>
      </CommonDialogContent>
    </Dialog>
  )
}

export default CanvasDeleteDialog
