import { Injectable } from '@nestjs/common';

/** 在岗豁免判定结果。 */
export interface ExemptResult {
  isExempt: boolean;
  onJobDays: number;
}

/** 参与豁免计算的用户片段。 */
export interface ExemptUser {
  entryDate: Date | null;
  leaveDate: Date | null;
}

/** 参与豁免计算的周期片段。 */
export interface ExemptCycle {
  startDate: Date;
  endDate: Date;
}

/**
 * 在岗豁免计算服务。
 *
 * 规则（评审决策 #4 修正版）：
 * - cycleTotal = days(endDate - startDate)   // 含边界，按自然日
 * - threshold  = cycleTotal * ratio          // ratio 取 system_configs.exempt_threshold_ratio
 * - onStart    = max(startDate, entryDate ?? startDate)
 * - onEnd      = min(endDate,   leaveDate ?? endDate)
 * - onJobDays  = max(0, days(onEnd - onStart))
 * - isExempt   = onJobDays < threshold
 */
@Injectable()
export class ExemptService {
  /**
   * 计算单个员工在考核周期内是否应被豁免。
   *
   * @param user - 员工对象，需包含 entryDate / leaveDate
   * @param cycle - 考核周期对象，需包含 startDate / endDate
   * @param ratio - 豁免阈值比例（如 0.3333）
   */
  calcExempt(user: ExemptUser, cycle: ExemptCycle, ratio: number): ExemptResult {
    const cycleTotal = this.daysInclusive(cycle.startDate, cycle.endDate);
    const threshold = cycleTotal * ratio;

    const onStart = this.maxDate(cycle.startDate, user.entryDate ?? cycle.startDate);
    const onEnd = this.minDate(cycle.endDate, user.leaveDate ?? cycle.endDate);
    const onJobDays = Math.max(0, this.daysInclusive(onStart, onEnd));

    return {
      isExempt: onJobDays < threshold,
      onJobDays,
    };
  }

  /** 含边界的自然日天数：同一天为 1 天。 */
  private daysInclusive(start: Date, end: Date): number {
    const startTime = this.startOfDay(start).getTime();
    const endTime = this.startOfDay(end).getTime();
    const diffMs = endTime - startTime;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays + 1;
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private maxDate(a: Date, b: Date): Date {
    return a >= b ? a : b;
  }

  private minDate(a: Date, b: Date): Date {
    return a <= b ? a : b;
  }
}
