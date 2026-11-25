import { Prisma } from '@prisma/client';

// All consumers use application alias a and the latest seat-event alias seat.
export const recruitmentSeatJoin = Prisma.sql`LEFT JOIN LATERAL (
  SELECT e.action, e.version FROM talent_application_events e
  WHERE e.application_id = a.id AND e.action IN ('accept_offer', 'terminate_offer')
  ORDER BY e.version DESC, e.id DESC LIMIT 1
) seat ON TRUE`;

export const currentRecruitmentDemandSql = Prisma.sql`CASE
  WHEN a.stage NOT IN ('hiring_review', 'offered', 'accepted', 'onboarding', 'hired')
    AND seat.action IS DISTINCT FROM 'accept_offer'
    AND NOT (a.stage = 'withdrawn' AND seat.action IS NOT DISTINCT FROM 'terminate_offer' AND seat.version = a.revision)
    THEN CASE WHEN a.intent_demand_id IS NOT NULL THEN a.intent_demand_id
      WHEN EXISTS (SELECT 1 FROM talent_application_events intent_event
        WHERE intent_event.application_id = a.id AND intent_event.action = 'change_intent') THEN NULL
      ELSE a.recruitment_demand_id END
  ELSE COALESCE(a.recruitment_demand_id, a.intent_demand_id) END`;

export const recruitmentProgressCategorySql = Prisma.sql`CASE
  WHEN seat.action = 'accept_offer' AND a.stage = 'hired' THEN 'hired'
  WHEN seat.action = 'accept_offer' THEN 'accepted'
  WHEN seat.action = 'terminate_offer' AND a.stage = 'withdrawn' AND seat.version = a.revision THEN 'terminated'
  WHEN a.stage = 'offered' THEN 'awaiting_reply'
  WHEN a.stage IN ('screening', 'interviewing', 'hiring_review') THEN a.stage
  ELSE NULL END`;
