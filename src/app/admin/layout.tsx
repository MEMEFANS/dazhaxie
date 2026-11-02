// 后台最外层布局：仅提供深色底，登录页与控制台共用

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-abyss text-strong">{children}</div>;
}
