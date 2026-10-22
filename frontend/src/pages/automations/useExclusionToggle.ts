import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../../api/client'
import { useSetAutomationExclusion } from '../../api/hooks'
import { useToast } from '../../components/ui/Toast'

/** Exclude one contact from automations (or bring it back), with feedback. */
export function useExclusionToggle() {
  const { t } = useTranslation()
  const toast = useToast()
  const mutation = useSetAutomationExclusion()
  const [busyId, setBusyId] = useState<number>()

  const toggle = (contact: { id: number; full_name: string }, excluded: boolean) => {
    const name = contact.full_name
    setBusyId(contact.id)
    mutation.mutate(
      { contact_ids: [contact.id], excluded },
      {
        onSuccess: ({ cancelled }) =>
          toast.success(
            !excluded
              ? t('audience.restoredToast', { name })
              : cancelled
                ? t('audience.excludedCancelled', { name, count: cancelled })
                : t('audience.excludedToast', { name }),
          ),
        onError: (error) => toast.error(errorMessage(error)),
        onSettled: () => setBusyId(undefined),
      },
    )
  }

  return { toggle, busyId }
}
