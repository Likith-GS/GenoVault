import { ReactNode } from "react";

interface Props {
  title:        string;
  description?: string;
  actions?:     ReactNode;
  action?:      ReactNode;  // alias used by some pages
  icon?:        ReactNode;
}

export const PageHeader = ({ title, description, actions, action, icon }: Props) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
        {icon && <span className="text-indigo-400">{icon}</span>}
        {title}
      </h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
    {(actions || action) && (
      <div className="flex gap-2">{actions ?? action}</div>
    )}
  </div>
);
