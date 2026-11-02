export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 px-5 py-8" role="status" aria-live="polite" aria-label="正在加载页面">
      <span className="sr-only">正在加载页面，请稍候。</span>
      <div className="skeleton h-7 w-24" aria-hidden="true" />
      <div className="skeleton h-10 w-52" aria-hidden="true" />
      <div className="card space-y-5 p-6" aria-hidden="true"><div className="skeleton h-5 w-2/3" /><div className="skeleton h-32 w-full" /><div className="grid grid-cols-2 gap-4"><div className="skeleton h-20" /><div className="skeleton h-20" /></div></div>
    </div>
  );
}
