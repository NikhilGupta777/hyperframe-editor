/**
 * Re-export of the composition mutation helpers that live in
 * @hyperframe-editor/compose. Kept here for the worker's tool-dispatch wiring
 * and any internal call-sites that want a worker-local import path.
 */
export {
  addClip,
  deleteClip,
  moveClip,
  setCompositionMeta,
  setTrackOrder,
  trimClip,
  type AddClipArgs,
  type DeleteClipArgs,
  type MoveClipArgs,
  type SetCompositionMetaArgs,
  type TrimClipArgs,
} from "@hyperframe-editor/compose";
