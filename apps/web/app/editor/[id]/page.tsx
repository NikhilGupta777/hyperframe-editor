import { EditorClient } from "./EditorClient";

/**
 * Server component. Awaits Next 15's Promise<params> and hands the resolved id
 * to the client component. Keeping this seam means hooks live entirely in the
 * client file and we don't fight the type system.
 */
export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditorClient id={id} />;
}
