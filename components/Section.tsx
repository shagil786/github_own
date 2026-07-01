import type { ReactNode } from "react";

type SectionProps = {
  title: string;
  description?: string;
  right?: ReactNode;
  children: ReactNode;
};

export function Section({ title, description, right, children }: SectionProps) {
  return (
    <section className="section">
      <div className="sectionHeader">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {right ? <div className="sectionRight">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}
