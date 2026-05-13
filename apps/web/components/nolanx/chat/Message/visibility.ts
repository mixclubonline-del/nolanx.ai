export const HIDE_IN_USER_UI_TAG = '<hide_in_user_ui>'
export const HIDE_IN_USER_UI_END_TAG = '</hide_in_user_ui>'

export function stripUiVisibilityTags(value: string) {
  return value
    .replaceAll(HIDE_IN_USER_UI_TAG, '')
    .replaceAll(HIDE_IN_USER_UI_END_TAG, '')
    .trim()
}
