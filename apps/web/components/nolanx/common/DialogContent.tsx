import * as React from 'react';
import { DialogContent } from '../ui/dialog';

type CommonDialogContentProps = React.ComponentProps<typeof DialogContent> & {
  open?: boolean;
};

export default function CommonDialogContent({ children, ...props }: CommonDialogContentProps) {
  return <DialogContent {...props}>{children}</DialogContent>;
}
