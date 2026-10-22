import type { TFunction } from 'i18next'
import type { FollowUpRule } from '../../api/types'

type RuleShape = Pick<FollowUpRule, 'trigger' | 'trigger_status' | 'action' | 'action_status' | 'action_tag' | 'delay_amount' | 'delay_unit'>

export function triggerText(rule: RuleShape, t: TFunction) {
  if (rule.trigger === 'status_is') {
    return rule.trigger_status ? t('trigger.status_is', { status: t(`status.${rule.trigger_status}`) }) : t('trigger.status_is_generic')
  }
  return t(`trigger.${rule.trigger}`)
}

export function actionText(rule: RuleShape, t: TFunction) {
  if (rule.action === 'change_status') {
    return rule.action_status ? t('action.change_status', { status: t(`status.${rule.action_status}`) }) : t('action.change_status_generic')
  }
  if (rule.action === 'add_tag') {
    return rule.action_tag.trim() ? t('action.add_tag', { tag: rule.action_tag.trim() }) : t('action.add_tag_generic')
  }
  return t('action.send_whatsapp')
}

export function delayText(rule: RuleShape, t: TFunction) {
  return t(`delay.${rule.delay_unit}`, { count: rule.delay_amount })
}
