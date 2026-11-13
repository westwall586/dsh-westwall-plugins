window.__ModuleLoader__.load({
  id: '@westwall/dsh-jira-worklogs',
  factory(require) {
    const React = require('react')
    const { useState, useRef, useEffect, useCallback } = React
    const h = React.createElement

    // 侧栏菜单行 id = main 键控面板 key（MainPanelId 为开放品牌串，非封闭枚举；
    // 见 ui-layout 'main' 槽契约——非 conversation key 无会话绑定）。
    const PANEL_ID = 'jiraWorklogs'
    const PANEL_LABEL = 'Jira 日志'

    // ---- remote service layer (host: JiraWorklogsService) ----

    // rc.1 起 $mount 校验要求 strict codec 携带 create() 工厂（TypertSchema 即
    // { parse }）；恒等 parse 线上语义等同 JSON 透传（0.1.5 的旧 schema 字段形态已被拒）。
    const JSON_CODEC = {
      mode: 'strict',
      typeSymbol: 'json',
      create: () => ({ parse: value => value }),
    }

    const JIRA_WORKLOGS_CONTRIBUTION = {
      package: 'dsh-jira-worklogs',
      descriptors: [
        {
          id: 'dsh-jira-worklogs/jiraWorklogs.overview',
          service: 'jiraWorklogs',
          namespace: 'jiraWorklogs',
          method: 'overview',
          invocation: { kind: 'direct' },
          parameters: [],
          result: JSON_CODEC,
        },
        {
          id: 'dsh-jira-worklogs/jiraWorklogs.dayDetail',
          service: 'jiraWorklogs',
          namespace: 'jiraWorklogs',
          method: 'dayDetail',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'date', wire: 'date', source: 'json', codec: JSON_CODEC },
          ],
          result: JSON_CODEC,
        },
        {
          id: 'dsh-jira-worklogs/jiraWorklogs.generate',
          service: 'jiraWorklogs',
          namespace: 'jiraWorklogs',
          method: 'generate',
          invocation: { kind: 'direct' },
          cancellation: { parameter: 'signal' },
          parameters: [
            { name: 'date', wire: 'date', source: 'json', codec: JSON_CODEC },
          ],
          result: JSON_CODEC,
        },
        {
          id: 'dsh-jira-worklogs/jiraWorklogs.submit',
          service: 'jiraWorklogs',
          namespace: 'jiraWorklogs',
          method: 'submit',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'request', wire: 'request', source: 'json', codec: JSON_CODEC },
          ],
          result: JSON_CODEC,
        },
        {
          id: 'dsh-jira-worklogs/jiraWorklogs.openOutbox',
          service: 'jiraWorklogs',
          namespace: 'jiraWorklogs',
          method: 'openOutbox',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'date', wire: 'date', source: 'json', codec: JSON_CODEC },
          ],
          result: JSON_CODEC,
        },
        {
          id: 'dsh-jira-worklogs/jiraWorklogs.dismissOutbox',
          service: 'jiraWorklogs',
          namespace: 'jiraWorklogs',
          method: 'dismissOutbox',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'date', wire: 'date', source: 'json', codec: JSON_CODEC },
          ],
          result: JSON_CODEC,
        },
        {
          id: 'dsh-jira-worklogs/jiraWorklogs.saveNotes',
          service: 'jiraWorklogs',
          namespace: 'jiraWorklogs',
          method: 'saveNotes',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'request', wire: 'request', source: 'json', codec: JSON_CODEC },
          ],
          result: JSON_CODEC,
        },
        {
          id: 'dsh-jira-worklogs/jiraWorklogs.query',
          service: 'jiraWorklogs',
          namespace: 'jiraWorklogs',
          method: 'query',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'request', wire: 'request', source: 'json', codec: JSON_CODEC },
          ],
          result: JSON_CODEC,
        },
      ],
    }

    /** RemoteResult 判别形状解包：{ok:true,value} | {ok:false,error}。 */
    function unwrap(result, what) {
      if (result && result.ok === true) return result.value
      let detail = '未知错误'
      if (result && result.ok === false && result.error) {
        detail = `${result.error.code ?? ''} ${result.error.message ?? ''}`.trim() || '未知错误'
        const cause = result.error.cause ?? result.error.details
        if (cause && cause.issues) {
          const issues = cause.issues.map(i => `${i.path?.join('.')}: ${i.message}`).join('; ')
          if (issues) detail += `（${issues}）`
        } else if (cause && typeof cause.message === 'string' && cause.message) {
          detail += `（${cause.message}）`
        }
      }
      throw new Error(`${what}失败：${detail}`)
    }

    function jiraWorklogsApi(ctx) {
      // 挂载的远程方法按「位置业务参数」调用（prepareInvocation 逐参 parseInput），
      // 不是 {wire: value} 记录形态。
      return {
        async overview() {
          return unwrap(await ctx.remote.jiraWorklogs.overview(), '工时查询')
        },
        async dayDetail(date) {
          return unwrap(await ctx.remote.jiraWorklogs.dayDetail(date), '日详情查询')
        },
        async generate(date) {
          return unwrap(await ctx.remote.jiraWorklogs.generate(date), '生成工时草稿')
        },
        async submit(request) {
          return unwrap(await ctx.remote.jiraWorklogs.submit(request), '提交工时')
        },
        async openOutbox(date) {
          return unwrap(await ctx.remote.jiraWorklogs.openOutbox(date), '打开暂存')
        },
        async dismissOutbox(date) {
          return unwrap(await ctx.remote.jiraWorklogs.dismissOutbox(date), '放弃暂存')
        },
        async saveNotes(request) {
          return unwrap(await ctx.remote.jiraWorklogs.saveNotes(request), '保存素材')
        },
        async query(request) {
          return unwrap(await ctx.remote.jiraWorklogs.query(request), '查同事日志')
        },
      }
    }

    // ---- date formatting (overview dates are YYYY-MM-DD, East-8) ----

    // ---- 侧栏面板图标 ----

    // 描摹宿主 IconListPenOutline（list+pen 记录单，「记工时」语义；与「插件」
    // 风车、「任务」时钟同族 current-color 线稿）。规范（practices.md）：插件不得
    // require ui-primitives，控件自绘、仅用主题令牌；currentColor 随宿主主题与
    // 菜单行选中态着色，尺寸由侧栏传入（wide 16 / rail 18）。
    const PANEL_ICON_STROKES = ['M4.9375 5.90295H11.0625', 'M4.9375 9.02991H8.27841']
    const PANEL_ICON_FILLS = [
      'M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V7.61328L13 8.68164V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H8.32812L7.39258 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5Z',
      'M8.97212 14.3693C9.17511 14.5723 9.37811 14.7753 9.5811 14.9783C9.67012 14.8953 9.75914 14.8123 9.84815 14.7293C11.4505 13.2352 13.0528 11.7411 14.6551 10.247C14.7441 10.164 14.8331 10.081 14.9221 9.99803C14.5989 9.6748 14.2756 9.35157 13.9524 9.02834C13.8694 9.11736 13.7864 9.20637 13.7034 9.29539C12.2093 10.8977 10.7152 12.5 9.22113 14.1023C9.13813 14.1913 9.05513 14.2803 8.97212 14.3693Z',
      'M11.6323 13.7841C11.6323 14.0395 11.6323 14.295 11.6323 14.5504C11.6812 14.5523 11.7301 14.5543 11.779 14.5562C12.659 14.5913 13.539 14.6263 14.419 14.6614C14.4679 14.6633 14.5168 14.6653 14.5657 14.6672C14.5657 14.3339 14.5657 14.0006 14.5657 13.6672C14.5168 13.6692 14.4679 13.6711 14.419 13.6731C13.539 13.7081 12.659 13.7432 11.779 13.7783C11.7301 13.7802 11.6812 13.7821 11.6323 13.7841Z',
    ]

    function JiraPanelIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true, strokeWidth: 1,
      },
        PANEL_ICON_STROKES.map((d, index) => h('path', { key: `s${index}`, d, stroke: 'currentColor' })),
        PANEL_ICON_FILLS.map((d, index) => h('path', { key: `f${index}`, d, fill: 'currentColor' })),
      )
    }

    /** 迷你日历弹层（20261023 Wave T09）：日期文本框的选日期控件——原生 date 控件
     * 显示格式跟随浏览器区域无法强制，故自绘；视觉令牌与月历同语言（选中＝品牌描边、
     * 今天＝次级描边、悬停＝交互底色）。周一开头，与月历 WEEKDAY_LABELS 一致。 */
    function MiniDatePicker({ value, onPick, onClose }) {
      const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
      const [month, setMonth] = useState(() => (value || today).slice(0, 7))
      const shift = delta => setMonth(prev => {
        const [y, m] = prev.split('-').map(Number)
        return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
      })
      const [year, mon] = month.split('-').map(Number)
      const lead = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7
      const days = new Date(Date.UTC(year, mon, 0)).getUTCDate()
      const cells = []
      for (let i = 0; i < lead; i += 1) cells.push(h('span', { key: `b${i}`, className: 'jw-qy-pop-blank' }))
      for (let d = 1; d <= days; d += 1) {
        const day = `${month}-${String(d).padStart(2, '0')}`
        cells.push(h('button', {
          key: day, type: 'button',
          className: 'jw-qy-pop-day'
            + (day === value ? ' jw-qy-pop-sel' : '')
            + (day === today ? ' jw-qy-pop-today' : ''),
          onClick: () => { onPick(day); onClose() },
        }, String(d)))
      }
      return h('div', { className: 'jw-qy-pop', role: 'dialog', 'aria-label': '选择日期' },
        h('div', { className: 'jw-qy-pop-head' },
          h('button', { type: 'button', className: 'jw-qy-pop-nav', 'aria-label': '上一月', onClick: () => shift(-1) }, '‹'),
          h('span', null, `${year}年${mon}月`),
          h('button', { type: 'button', className: 'jw-qy-pop-nav', 'aria-label': '下一月', onClick: () => shift(1) }, '›')),
        h('div', { className: 'jw-qy-pop-grid' },
          WEEKDAY_LABELS.map(label => h('span', { key: label, className: 'jw-qy-pop-wd' }, label.slice(1))),
          cells),
        h('div', { className: 'jw-qy-pop-foot' },
          h('button', { type: 'button', className: 'jw-qy-pop-act', onClick: () => { onPick(''); onClose() } }, '清空'),
          h('button', { type: 'button', className: 'jw-qy-pop-act', onClick: () => { onPick(today); onClose() } }, '今天'),
          h('button', { type: 'button', className: 'jw-qy-pop-act', onClick: onClose }, '关闭')))
    }

    // ---- 查同事日志（20261023 Wave）：底部可折叠只读查询区 ----
    // 默认收起；与本人动线互不锁定（挂载点不接 generating/submitting）；
    // 收起仅放弃关注——不中止在途请求、已得结果保留至下次查询（SPEC 方向决定）。

    function QueryBlock({ api }) {
      const [open, setOpen] = useState(false)
      const [name, setName] = useState('')
      const [from, setFrom] = useState(() => new Date(Date.now() + 8 * 3600000 - 6 * 86400000).toISOString().slice(0, 10))
      const [to, setTo] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
      const [busy, setBusy] = useState(false)
      const [view, setView] = useState(null)
      const [error, setError] = useState(null)
      const [picker, setPicker] = useState(null) // 'from' | 'to' | null——同一时刻至多一个弹层

      const onQuery = useCallback(async () => {
        if (busy || !name.trim()) return
        setBusy(true)
        setError(null)
        try {
          setView(await api.query({ name: name.trim(), from: from || undefined, to: to || undefined }))
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }, [api, busy, name, from, to])

      const head = h('button', {
        type: 'button', className: 'jw-qy-head', 'aria-expanded': open,
        onClick: () => setOpen(value => !value),
      }, `${open ? '▾' : '▸'} 查同事日志`)

      if (!open) return h('div', { className: 'jw-qy' }, head)

      let result = null
      if (view != null) {
        const v = view
        if (v.status === 'ok') {
          result = h('div', { className: 'jw-qy-result' },
            h('div', { className: 'jw-qy-note' }, `${v.displayName}（${v.name}） · ${v.permissionNote}`),
            v.notice != null ? h('div', { className: 'jw-qy-note' }, `ℹ️ ${v.notice}`) : null,
            (v.days ?? []).length === 0 ? h('div', { className: 'jw-none' }, '该窗口无日志') : null,
            (v.days ?? []).map(day => h('div', { key: day.date, className: 'jw-qy-day' },
              h('div', { className: 'jw-qy-date' }, `${day.date}（${day.weekday}）· ${day.totalHours}h`),
              day.entries.map((entry, index) => h('div', { key: index, className: 'jw-qy-entry' },
                h('div', { className: 'jw-qy-entry-line' },
                  h('span', null, `${entry.hours}h `),
                  h('a', { href: entry.issueUrl, target: '_blank', rel: 'noreferrer' }, entry.issueKey),
                  h('span', null, ` ${entry.summary}`)),
                entry.comment ? h('div', { className: 'jw-qy-comment' }, entry.comment) : null,
              )),
            )),
          )
        } else if (v.status === 'ambiguous') {
          // notice 文案已内嵌全部候选清单（service.ambiguousNotice），不逐行重复渲染
          result = h('div', { className: 'jw-qy-result' }, h('div', { className: 'jw-qy-note' }, v.notice))
        } else {
          result = h('div', { className: 'jw-qy-result' }, h('div', { className: 'jw-qy-note' }, v.notice))
        }
      } else if (busy) {
        result = h('div', { className: 'jw-none' }, '查询中……（可收起放弃关注，请求不受影响）')
      }

      return h('div', { className: 'jw-qy' },
        head,
        h('div', { className: 'jw-qy-form' },
          h('input', {
            className: 'jw-in', value: name, placeholder: '同事中文名或登录 ID', 'aria-label': '同事名字',
            onChange: e => setName(e.target.value),
          }),
          // 日期＝文本输入（yyyy-mm-dd 直改、斜杠归一）＋迷你日历弹层选日期（T09）
          h('span', { className: 'jw-qy-dwrap' },
            h('input', {
              className: 'jw-in', value: from, placeholder: 'YYYY-MM-DD', inputMode: 'numeric',
              'aria-label': '开始日期（可清空为不限）',
              onChange: e => setFrom(e.target.value.replace(/\//g, '-')),
            }),
            h('button', {
              type: 'button', className: 'jw-qy-dbtn', 'aria-label': '选择开始日期',
              'aria-expanded': picker === 'from',
              onClick: () => setPicker(value => (value === 'from' ? null : 'from')),
            }, '📅'),
            picker === 'from'
              ? h(MiniDatePicker, { value: from, onPick: setFrom, onClose: () => setPicker(null) })
              : null),
          h('span', { className: 'jw-qy-dwrap' },
            h('input', {
              className: 'jw-in', value: to, placeholder: 'YYYY-MM-DD', inputMode: 'numeric',
              'aria-label': '结束日期（可清空为不限）',
              onChange: e => setTo(e.target.value.replace(/\//g, '-')),
            }),
            h('button', {
              type: 'button', className: 'jw-qy-dbtn', 'aria-label': '选择结束日期',
              'aria-expanded': picker === 'to',
              onClick: () => setPicker(value => (value === 'to' ? null : 'to')),
            }, '📅'),
            picker === 'to'
              ? h(MiniDatePicker, { value: to, onPick: setTo, onClose: () => setPicker(null) })
              : null),
          h('button', {
            type: 'button', className: 'jw-btn', disabled: busy || !name.trim(),
            onClick: () => void onQuery(),
          }, busy ? '查询中…' : '查询'),
        ),
        error != null ? h('div', { className: 'jw-note-status' }, `⚠ ${error}`) : null,
        result,
      )
    }

    // ---- 面板化主页面：月历五区视图（页面定版基线的真接线形态） ----
    // 数据经 ctx.remote.jiraWorklogs.{overview,dayDetail,generate,submit}
    //（页面先行期的 mock 层已移除）。

    const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    /** 0=周一 … 6=周日（按东八区日期串）。 */
    function weekdayIndexOf(dateKey) {
      return (new Date(Date.parse(`${dateKey}T00:00:00Z`)).getUTCDay() + 6) % 7
    }

    /** HH:MM → 分钟数；非法返回 null。 */
    function timeToMinutes(value) {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
      if (!match) return null
      const minutes = Number(match[1]) * 60 + Number(match[2])
      return minutes >= 0 && minutes < 1440 ? minutes : null
    }

    /** 开始/结束 → 小时（两位小数）；任一非法或 end<=start 返回 null。 */
    function diffHours(start, end) {
      const a = timeToMinutes(start)
      const b = timeToMinutes(end)
      if (a === null || b === null || b <= a) return null
      return Math.round(((b - a) / 60) * 100) / 100
    }

    function fmtHours(value) {
      return Math.round(value * 100) / 100
    }

    /** 时刻输入即时归一：'9:05' → '09:05'（与 Host 侧 started 组装的两位形态对齐，终审 F4）。 */
    function padTimeInput(value) {
      return String(value ?? '').replace(/^(\d):(\d{2})$/, '0$1:$2')
    }

    // —— V2 展示组件 ——

    function CalendarMonth({ month, selected, onSelect, locked }) {
      const [year, monthNo] = month.month.split('-').map(Number)
      const lead = weekdayIndexOf(`${month.month}-01`)
      const daysInMonth = new Date(Date.UTC(year, monthNo, 0)).getUTCDate()
      const rowMap = new Map(month.rows.map(row => [row.date, row]))
      const cells = []
      for (let i = 0; i < lead; i++) cells.push(null)
      for (let day = 1; day <= daysInMonth; day++) cells.push(`${month.month}-${pad2(day)}`)
      return h('div', { className: 'jw-cal' },
        WEEKDAY_LABELS.map(label => h('span', { key: label, className: 'jw-cal-wd' }, label)),
        cells.map((key, index) => {
          if (key === null) return h('span', { key: `blank${index}`, className: 'jw-day jw-day-blank' })
          const wknd = weekdayIndexOf(key) >= 5
          const future = key > month.today
          const row = rowMap.get(key)
          const cls = ['jw-day']
          if (wknd) cls.push('jw-day-wknd')
          if (future) cls.push('jw-day-future')
          else if (row && row.status === 'gap') cls.push('jw-day-gap')
          if (key === month.today) cls.push('jw-day-today')
          if (key === selected) cls.push('jw-day-sel')
          if (locked) cls.push('jw-day-locked')
          return h('button', {
            key, type: 'button', className: cls.join(' '),
            disabled: future || locked,
            'aria-label': key,
            onClick: () => onSelect(key),
          },
          // 已填满工作日 ✓ 标记（20261028，纯展示层）——调休周末不在 monthStatus 数据
          // 口径内（引擎仅产周一至五），周末已填标记需数据形态变更，暂不做（用户裁决）
            Number(key.slice(8)),
            row && row.status === 'gap' && !future ? h('span', { key: 'gapdot', className: 'jw-day-dot jw-day-dot-gap' }, '缺') : null,
            row && row.status === 'full' ? h('span', { key: 'fulldot', className: 'jw-day-dot jw-day-dot-full' }, '✓') : null,
            key === month.today ? h('span', { key: 'todaydot', className: 'jw-day-dot' }, '今') : null,
          )
        }),
      )
    }

    function detailHeadLabel(date) {
      const tail = date.slice(5).replace('-', '/')
      return `${tail} ${WEEKDAY_LABELS[weekdayIndexOf(date)]}`
    }

    function DayDetailBlock({ detail }) {
      const gap = detail.workday && detail.gapHours > 0
      return h('div', { className: 'jw-detail' + (gap ? ' jw-detail-gap' : '') },
        h('div', { className: 'jw-d-sum' },
          h('span', { className: 'jw-d-date' }, `${detailHeadLabel(detail.date)}${gap ? ' · 有缺口' : ''}`),
          detail.workday
            ? h('span', { className: 'jw-d-nums' }, `已填 ${fmtHours(detail.loggedHours)}h / 缺口 ${fmtHours(detail.gapHours)}h`)
            : null,
        ),
        detail.tasks.length === 0
          ? h('div', { className: 'jw-none' }, '当日无登记')
          : detail.tasks.map(task => h('div', { key: task.name, className: 'jw-task' },
              h('div', { className: 'jw-task-name' }, task.name),
              task.entries.length === 0
                ? h('div', { className: 'jw-none' }, '当日无登记')
                : task.entries.map((entry, index) => h('div', { key: index, className: 'jw-entry' },
                    h('span', { className: 'rng' }, entry.timeRange),
                    h('span', { className: 'hrs' }, `${fmtHours(entry.hours)}h`),
                    h('span', null, entry.comment),
                  )),
            )),
      )
    }

    function GitBlock({ git, expanded, onToggle }) {
      if (!git) return h('div', { className: 'jw-git' }, h('div', { className: 'jw-none' }, '无提交素材'))
      const projects = [...new Set(git.byProject.map(item => item.project))]
      return h('div', { className: 'jw-git' },
        h('div', { className: 'jw-muted' }, `${git.pushes} 次推送 · ${git.commits} 个提交 · ${projects.join('、')}`),
        h('button', { type: 'button', className: 'jw-git-toggle', onClick: onToggle },
          expanded ? '▾ 收起提交' : '▸ 按项目查看提交'),
        expanded ? git.byProject.map(item => h('div', { key: item.project, className: 'jw-git-grp' },
          h('div', null, item.project),
          item.commits.map((commit, index) => h('div', { key: index, className: 'jw-commit' },
            h('span', { className: 'rng' }, commit.time),
            h('span', null, commit.title),
          )),
        )) : null,
      )
    }

    function resultLabel(result) {
      const prefix = {
        written: '✓ 已写入',
        skipped: '○ 已跳过',
        uncertain: '⚠ 不确定（需人工核对）',
        failed: '⚠ 失败',
      }[result.status] ?? result.status
      return result.reason ? `${prefix}：${result.reason}` : prefix
    }

    // 条目结果行：状态文字 + （uncertain 时）「到 Jira 核对」外链。
    function ResultLine({ result }) {
      return h('span', { className: `jw-st jw-st-${result.status}` },
        resultLabel(result),
        result.status === 'uncertain' && result.issueUrl
          ? h('a', {
              className: 'jw-st-link', href: result.issueUrl, target: '_blank', rel: 'noreferrer',
              onClick: e => e.stopPropagation(),
            }, ' → 到 Jira 核对')
          : null,
      )
    }

    function NoticeBox({ notice, onAction }) {
      return h('div', { className: 'jw-error' },
        h('div', { className: 'jw-error-title' }, notice.title),
        h('div', null, notice.message),
        notice.retry || notice.refresh || notice.dismiss
          ? h('div', { style: { marginTop: 8, display: 'flex', gap: 8 } },
              notice.retry ? h('button', { className: 'jw-btn jw-btn-primary', onClick: () => onAction('retry') }, '重试') : null,
              notice.refresh ? h('button', { className: 'jw-btn', onClick: () => onAction('refresh') }, '刷新') : null,
              notice.dismiss ? h('button', { className: 'jw-btn jw-btn-primary', onClick: () => onAction('dismiss') }, notice.dismiss) : null,
            )
          : null,
      )
    }

    // —— 20261015 Wave：暂存提示条与手动素材区 ——

    /** 暂存提示条：overview.outbox 驱动——多日聚合、展开逐日清单（打开定位 / 放弃需确认）、
     * 读取失败错误态（不阻断月历）；存储缺席降级提示（终审 F-1）。空态不渲染。 */
    function OutboxBanner({ outbox, outboxError, outboxUnavailable, onOpen, onDismiss, onRefresh, locked }) {
      const [expanded, setExpanded] = useState(false)
      if (outboxUnavailable) {
        return h('div', { className: 'jw-outbox jw-outbox-error' },
          h('div', { className: 'jw-none' }, '存储不可用，暂存功能暂不可用；月历与日详情不受影响。'))
      }
      if (outboxError) {
        return h('div', { className: 'jw-outbox jw-outbox-error' },
          h('div', { className: 'jw-error-title' }, '暂存读取失败'),
          h('div', null, '存储暂不可用，暂存提示暂不能显示；月历与日详情不受影响。'),
          h('div', { style: { marginTop: 8 } },
            h('button', { className: 'jw-btn', onClick: onRefresh }, '刷新')))
      }
      if (!outbox || outbox.total === 0 || (outbox.days ?? []).length === 0) return null
      const days = outbox.days
      const multi = days.length > 1
      const label = day => `${day.date.slice(5).replace('-', '/')} ${day.count} 条待重试提交`
      return h('div', { className: 'jw-outbox' },
        h('div', { className: 'jw-outbox-row' },
          h('span', { className: 'jw-outbox-text' }, multi ? `${days.length} 日共 ${outbox.total} 条待重试提交` : label(days[0])),
          h('span', { className: 'jw-outbox-actions' },
            h('button', { type: 'button', className: 'jw-btn jw-btn-primary', disabled: locked, onClick: () => setExpanded(value => !value) }, expanded ? '收起' : '查看'),
            !multi
              ? h('button', { type: 'button', className: 'jw-btn', disabled: locked,
                  onClick: () => { if (window.confirm(`放弃 ${days[0].date} 的暂存？放弃后不写任何内容。`)) onDismiss(days[0].date) } }, '放弃')
              : null)),
        expanded ? days.map(day => h('div', { key: day.date, className: 'jw-outbox-day' },
          h('span', null, label(day)),
          h('span', { className: 'jw-outbox-actions' },
            h('button', { type: 'button', className: 'jw-btn', disabled: locked, onClick: () => onOpen(day.date) }, '打开'),
            h('button', { type: 'button', className: 'jw-btn', disabled: locked,
              onClick: () => { if (window.confirm(`放弃 ${day.date} 的暂存？放弃后不写任何内容。`)) onDismiss(day.date) } }, '放弃')))) : null)
    }

    const NOTES_DEBOUNCE_MS = 800

    /** 手动素材区：dayDetail.notes + candidates 驱动——编辑停止 800ms 防抖整日自动保存；
     * 保存失败行内提示＋重试（输入不丢）；已存条目经 id 保留任务、换任务经候选下拉；
     * 非缺口日不显示引导（guide=false）；notesError 区域降级。 */
    function NotesBlock({ api, date, notes, candidates, notesError, guide, locked }) {
      const [items, setItems] = useState(null)
      const [saveState, setSaveState] = useState(null) // { kind: 'saving' } | { kind: 'error', message }
      const aliveRef = useRef(true)
      const timerRef = useRef(null)
      useEffect(() => () => {
        aliveRef.current = false
        if (timerRef.current) clearTimeout(timerRef.current)
      }, [])
      // 日期切换 / 远端视图变更：重置本地态并取消未落盘的防抖
      useEffect(() => {
        setItems((notes ?? []).map(note => ({ id: note.id, taskName: note.taskName, text: note.text })))
        setSaveState(null)
        if (timerRef.current) clearTimeout(timerRef.current)
      }, [date, notes])

      const persist = (nextItems) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(async () => {
          setSaveState({ kind: 'saving' })
          try {
            const result = await api.saveNotes({
              date,
              items: nextItems.map(item => ({
                ...(item.id != null ? { id: item.id } : {}),
                ...(item.candidateId != null ? { candidateId: item.candidateId } : {}),
                text: item.text,
              })),
            })
            if (!aliveRef.current) return
            setItems(result.items.map(note => ({ id: note.id, taskName: note.taskName, text: note.text })))
            setSaveState(null)
          } catch (error) {
            if (aliveRef.current) setSaveState({ kind: 'error', message: (error && error.message) || String(error) })
          }
        }, NOTES_DEBOUNCE_MS)
      }

      const editItem = (index, part) => {
        const next = items.map((item, i) => i === index ? { ...item, ...part } : item)
        setItems(next)
        persist(next) // 空文本条目由服务端过滤——保存成功后行消失（清空即删）
      }
      const removeItem = index => {
        const next = items.filter((_, i) => i !== index)
        setItems(next)
        persist(next)
      }
      const addItem = () => {
        const first = (candidates ?? [])[0]
        setItems(prev => [...(prev ?? []), { candidateId: first?.id, taskName: first?.name ?? '', text: '' }])
        // 新空行不触发保存（服务端过滤空文本），用户输入后经 editItem 落盘
      }

      if (notesError) {
        return h('div', { className: 'jw-notes jw-notes-error' },
          h('div', { className: 'jw-none' }, '素材读取失败（存储暂不可用）；日详情不受影响。'))
      }
      // 存储缺席：候选与素材字段均省略——区域整体降级提示，不渲染可填写表单（终审 F-1）
      if (candidates === undefined && notes === undefined) {
        return h('div', { className: 'jw-notes jw-notes-error' },
          h('div', { className: 'jw-none' }, '存储不可用，素材记录暂不可用；月历与日详情不受影响。'))
      }
      if (items == null) return null
      return h('div', { className: 'jw-notes' },
        h('div', { className: 'jw-notes-head' }, `手动素材${items.length > 0 ? ` · ${items.length} 条` : ''}`),
        guide && items.length === 0
          ? h('div', { className: 'jw-none' }, '补充编码外工作（会议、评审、沟通等），生成时一并参考')
          : null,
        items.map((item, index) => h('div', { key: item.id ?? `new-${index}`, className: 'jw-note' },
          h('div', { className: 'jw-note-row' },
            h('select', {
              className: 'jw-in', disabled: locked, 'aria-label': '素材任务',
              value: item.candidateId ?? '',
              onChange: e => {
                const id = Number(e.target.value)
                const picked = (candidates ?? []).find(candidate => candidate.id === id)
                editItem(index, { candidateId: id, taskName: picked?.name ?? item.taskName })
              },
            },
              item.id != null && item.candidateId == null
                ? h('option', { key: '__held', value: '' }, item.taskName)
                : null,
              (candidates ?? []).map(candidate => h('option', { key: candidate.id, value: candidate.id }, candidate.name))),
            h('button', {
              type: 'button', className: 'jw-del', disabled: locked, 'aria-label': '删除素材',
              onClick: () => removeItem(index),
            }, '✕')),
          h('textarea', {
            className: 'jw-in jw-note-text', rows: 2, disabled: locked, value: item.text,
            placeholder: '做了什么（生成时作为该任务的素材）', 'aria-label': '素材内容',
            onChange: e => editItem(index, { text: e.target.value }),
          }))),
        h('button', {
          type: 'button', className: 'jw-add', disabled: locked || !candidates || candidates.length === 0,
          onClick: addItem,
        }, '＋ 添加素材'),
        saveState?.kind === 'error'
          ? h('div', { className: 'jw-note-status' },
              `保存失败：${saveState.message}（输入未丢）`,
              h('button', { type: 'button', className: 'jw-btn', style: { marginLeft: 8 }, onClick: () => persist(items) }, '重试'))
          : saveState?.kind === 'saving' ? h('div', { className: 'jw-note-status' }, '保存中…') : null,
      )
    }

    // 主栏页面组件：状态与数据流承自弹窗改版（WorklogWindow），外壳换为宿主
    // 页面容器——无遮罩、无关闭、无焦点圈定，随面板切换挂载/卸载。
    function JiraWorklogsPage({ ctx }) {
      const api = useRef(jiraWorklogsApi(ctx)).current
      const [loading, setLoading] = useState(true)
      const [failure, setFailure] = useState(null) // { title, message, refresh? }
      const [month, setMonth] = useState(null)
      const [selected, setSelected] = useState(null)
      const [detail, setDetail] = useState(null)
      const [detailLoading, setDetailLoading] = useState(false)
      const [phase, setPhase] = useState('idle') // idle | generating | draft | submitting
      const [draft, setDraft] = useState(null)   // { doc, entries, results: {uid: result} | null }
      const [notice, setNotice] = useState(null)
      const [detailExpanded, setDetailExpanded] = useState(true)
      const [gitExpanded, setGitExpanded] = useState(false)
      const aliveRef = useRef(true)
      useEffect(() => () => { aliveRef.current = false }, [])

      const loadMonth = useCallback(async (silent) => {
        if (!silent) setLoading(true)
        try {
          const next = await api.overview()
          if (!aliveRef.current) return
          if (next && next.error === 'jira-credentials') {
            setMonth(null)
            setFailure({ title: '缺少连接配置', message: next.message || 'Jira 地址、账号与密码尚未配置，请到 插件页 → Jira 工时记录 详情页补齐，保存后回本窗口刷新即可。' })
            return
          }
          setMonth(next)
          setFailure(null)
          setSelected(prev => prev ?? next.today)
        } catch (error) {
          if (!aliveRef.current) return
          // 静默刷新（提交后/放弃暂存后）失败保留旧月历——暂存提示条与缺口数据不因
          // 单次刷新波动被错误屏覆盖；显式加载才切错误态。
          if (!silent) {
            setMonth(null)
            setFailure({ title: '查询失败', message: (error && error.message) || String(error), refresh: true })
          }
        } finally {
          if (!silent && aliveRef.current) setLoading(false)
        }
      }, [api])

      const loadDetail = useCallback(async (date) => {
        setDetailLoading(true)
        setDetail(null)
        try {
          const next = await api.dayDetail(date)
          if (aliveRef.current) setDetail(next)
        } catch (error) {
          if (aliveRef.current) {
            setDetail({ date, workday: true, loggedHours: 0, tasks: [], git: null, error: (error && error.message) || String(error) })
          }
        } finally {
          if (aliveRef.current) setDetailLoading(false)
        }
      }, [api])

      useEffect(() => { void loadMonth() }, [loadMonth])
      useEffect(() => { if (selected != null) void loadDetail(selected) }, [selected, loadDetail])

      const generating = phase === 'generating'
      const submitting = phase === 'submitting'
      const formOpen = draft != null && selected === draft.doc.date && (phase === 'draft' || submitting)
      const selectedGap = month != null && month.rows.some(row => row.date === selected && row.status === 'gap')
      const canGenerate = !generating && !submitting && selectedGap && detail != null && !detailLoading && !detail.error

      const entryHours = entry => diffHours(entry.start, entry.end)
      const entryInvalid = entry => {
        if (entryHours(entry) == null) return '时刻需为 HH:MM 且结束晚于开始'
        if (!entry.comment.trim()) return '说明不能为空'
        return null
      }
      const anyInvalid = draft != null && draft.entries.some(entry => entryInvalid(entry) != null)
      const totalHours = draft == null ? 0 : draft.entries.reduce((sum, entry) => sum + (entryHours(entry) ?? 0), 0)
      // 提交回报中仍有未回报/失败/uncertain 条目——重提入口的存在信号（切换保护同口径复用）
      const pendingResults = value => value.results != null && value.entries.some(entry => {
        const result = value.results[entry.uid]
        return result == null || result.status === 'failed' || result.status === 'uncertain'
      })
      const resubmittable = draft != null && pendingResults(draft)

      const selectDay = useCallback((date) => {
        if (generating || submitting || date === selected) return
        if (draft != null && phase === 'draft' && date !== draft.doc.date) {
          // D14：切换保护只拦「会丢东西」的形态——未提交时有编辑或增删条目；已提交后仍有
          // 未回报/失败/uncertain 条目（终审 F3 的可重提保护）或提交后又编辑；全部成功后直接切换
          const touched = draft.results == null
            ? (draft.entries.some(entry => entry.userEdited) || draft.entries.length !== draft.doc.entries.length)
            : (pendingResults(draft) || draft.editedSinceSubmit === true)
          if (touched && !window.confirm('切换将丢弃未提交的表单修改，确定切换？')) return
          setDraft(null)
        }
        setNotice(null)
        setDetailExpanded(true)
        setSelected(date)
      }, [generating, submitting, draft, phase, selected])

      const onGenerate = useCallback(async () => {
        if (!selectedGap || generating || submitting) return
        setPhase('generating')
        setNotice(null)
        setDetailExpanded(false)
        setGitExpanded(false)
        try {
          const doc = await api.generate(selected)
          if (!aliveRef.current) return
          setDraft({
            doc,
            // noteConfirmed（素材原话）条目初始按用户口径（userEdited=true——comment_source 语义）
            entries: doc.entries.map((entry, index) => ({
              uid: `e${index}-${doc.draftId}`, ...entry, userEdited: entry.noteConfirmed === true,
            })),
            results: null,
            editedSinceSubmit: false,
          })
          setPhase('draft')
        } catch (error) {
          if (!aliveRef.current) return
          setPhase('idle')
          setDetailExpanded(true)
          const message = (error && error.message) || String(error)
          if (message.includes('默认模型路由不可用')) {
            setNotice({ title: '生成不可用', message: '当前默认模型路由不可用（未注册提供方或凭据缺失），请到平台设置检查默认模型后再来重试。', retry: true })
          } else {
            setNotice({ title: '生成失败', message: `${message.includes('解析') ? `${message}，未写入任何内容。` : message}`, retry: true })
          }
        }
      }, [selectedGap, generating, submitting, api, selected])

      const patchEntry = (uid, part) => setDraft(prev => prev && {
        ...prev,
        // 已提交后再编辑：标记 editedSinceSubmit——切换保护兜底，防静默丢掉提交后的修改
        ...(prev.results != null ? { editedSinceSubmit: true } : {}),
        entries: prev.entries.map(entry => entry.uid === uid
          // 暂存回显的 uncertain 条目被编辑时标记——提交前走人工核对确认（SPEC 约束）
          ? { ...entry, ...part, userEdited: true, ...(entry.lastStatus === 'uncertain' ? { outboxTouched: true } : {}) }
          : entry),
      })

      const removeEntry = (uid) => setDraft(prev => prev && {
        ...prev,
        ...(prev.results != null ? { editedSinceSubmit: true } : {}),
        entries: prev.entries.filter(entry => entry.uid !== uid),
      })

      const addEntry = () => setDraft(prev => {
        if (!prev) return prev
        const used = new Set(prev.entries.map(entry => entry.taskId))
        const task = prev.doc.tasks.find(item => !used.has(item.id)) ?? prev.doc.tasks[0]
        const entry = { uid: `n${Date.now()}`, taskId: task.id, start: '15:00', end: '16:00', comment: '', userEdited: true }
        return { ...prev, ...(prev.results != null ? { editedSinceSubmit: true } : {}), entries: [...prev.entries, entry] }
      })

      const onSubmit = useCallback(async (resubmit) => {
        if (draft == null || submitting || anyInvalid) return
        // uncertain 条目编辑后重提：先人工核对（SPEC 约束——编辑使查重失配，可能写重）
        if (draft.entries.some(entry => entry.lastStatus === 'uncertain' && entry.outboxTouched)
          && !window.confirm('有条目上次写入结果未确认（uncertain）且已被编辑——重提前请先到 Jira 核对是否已写入：已写入请删除该条，未写入再继续。确定继续提交？')) return
        const candidates = resubmit === true
          ? draft.entries.filter(entry => {
              const result = draft.results ? draft.results[entry.uid] : undefined
              return result == null || result.status === 'failed' || result.status === 'uncertain'
            })
          : draft.entries
        if (resubmit !== true && candidates.length === 0) return
        if (candidates.length === 0) return
        setPhase('submitting')
        setNotice(null)
        try {
          const payload = candidates.map(entry => ({
            taskId: entry.taskId, start: entry.start, end: entry.end,
            comment: entry.comment, userEdited: entry.userEdited,
          }))
          const report = await api.submit({ draftId: draft.doc.draftId, entries: payload })
          if (!aliveRef.current) return
          if (report.status === 'blocked') {
            setNotice({ title: `提交被拒（${draft.doc.date}）`, message: (report.errors ?? []).join('；') || '校验未通过', dismiss: '修改后重提' })
            setPhase('draft')
            return
          }
          // 回报与请求条目等长同序——按序对回（PLAN 数据设计，同任务多条不歧义）
          const nextResults = { ...(draft.results ?? {}) }
          candidates.forEach((entry, index) => {
            nextResults[entry.uid] = (report.results ?? [])[index]
              ?? { taskId: entry.taskId, start: entry.start, end: entry.end, status: 'failed', reason: '未收到该条回报' }
          })
          setDraft(prev => prev && { ...prev, results: nextResults, editedSinceSubmit: false })
          setPhase('draft')
          if (report.outboxSaved === false) {
            setNotice({
              title: '暂存未生效',
              message: '提交失败内容未能写入暂存（存储不可用）——请勿关闭面板或重启 DSH，可在表单内直接重试提交。',
              dismiss: '知道了',
            })
          }
          void loadMonth(true)
          void loadDetail(draft.doc.date)
        } catch (error) {
          if (!aliveRef.current) return
          setNotice({ title: '提交失败', message: (error && error.message) || String(error), dismiss: '知道了' })
          setPhase('draft')
          // 抛错路径同样刷新 overview——暂存若已落盘且查询可用，提示条即时出现（审计 M4）
          void loadMonth(true)
        }
      }, [draft, submitting, anyInvalid, api, loadMonth, loadDetail])

      const onNoticeAction = (action) => {
        setNotice(null)
        if (action === 'retry') void onGenerate()
        else if (action === 'refresh') void loadMonth()
      }

      /** 暂存回显：定位复用切日保护与锁定口径；openOutbox 返回的草稿文档直接进表单
       *（lastStatus 渲染上次失败形态、userEdited 取暂存快照）。 */
      const onOpenOutbox = useCallback(async (date) => {
        if (generating || submitting) return
        if (draft != null && phase === 'draft' && date !== draft.doc.date) {
          // 切日保护同 selectDay：未提交看编辑/增删，已提交看待重提条目或提交后再编辑
          const touched = draft.results == null
            ? (draft.entries.some(entry => entry.userEdited) || draft.entries.length !== draft.doc.entries.length)
            : (pendingResults(draft) || draft.editedSinceSubmit === true)
          if (touched && !window.confirm('切换将丢弃未提交的表单修改，确定切换？')) return
          setDraft(null)
        }
        setNotice(null)
        try {
          const doc = await api.openOutbox(date)
          if (!aliveRef.current) return
          setSelected(date)
          setDraft({
            doc,
            entries: doc.entries.map((entry, index) => {
              const { lastStatus, issueUrl, noteConfirmed, userEdited, ...rest } = entry
              return {
                uid: `o${index}-${doc.draftId}`, ...rest,
                userEdited: userEdited ?? noteConfirmed ?? false,
                lastStatus, issueUrl, outboxTouched: false,
              }
            }),
            results: null,
            editedSinceSubmit: false,
          })
          setPhase('draft')
          setDetailExpanded(false)
          void loadDetail(date)
        } catch (error) {
          if (!aliveRef.current) return
          setNotice({ title: '打开暂存失败', message: (error && error.message) || String(error), refresh: true })
        }
      }, [generating, submitting, draft, phase, api, loadDetail])

      const onDismissOutbox = useCallback(async (date) => {
        try {
          await api.dismissOutbox(date)
          if (!aliveRef.current) return
          if (draft != null && phase === 'draft' && draft.doc.date === date) {
            setDraft(null)
            setPhase('idle')
          }
          void loadMonth(true)
        } catch (error) {
          if (!aliveRef.current) return
          setNotice({ title: '放弃暂存失败', message: (error && error.message) || String(error), refresh: true })
        }
      }, [api, draft, phase, loadMonth])

      // —— 组装：宿主页面容器模式（描摹 PluginManagerPage——居中列 + 头行 + 内容），
      //    弹窗期的遮罩/焦点圈定/Escape/关闭钮随模态形态一并移除（页面无关闭语义）。 ——

      const body = []
      if (month != null) {
        body.push(h(OutboxBanner, {
          key: 'outbox', outbox: month.outbox, outboxError: month.outboxError,
          outboxUnavailable: month.outboxUnavailable,
          onOpen: date => void onOpenOutbox(date), onDismiss: date => void onDismissOutbox(date),
          onRefresh: () => void loadMonth(), locked: generating || submitting,
        }))
        body.push(h('div', { key: 'cal-title', className: 'jw-cal-title' },
          h('span', null, `${month.month.slice(0, 4)} 年 ${Number(month.month.slice(5))} 月`),
          h('span', { className: 'jw-muted' }, `缺口 ${month.gapCount} 天`)))
        body.push(h(CalendarMonth, {
          key: 'cal', month, selected,
          onSelect: selectDay,
          locked: generating || submitting,
        }))
      }
      if (loading) {
        body.push(h('div', { key: 'loading', className: 'jw-note' }, '查询中…'))
      } else if (failure != null) {
        body.push(h('div', { key: 'failure', className: 'jw-error' },
          h('div', { className: 'jw-error-title' }, failure.title),
          h('div', null, failure.message),
          failure.refresh
            ? h('div', { style: { marginTop: 8 } },
                h('button', { className: 'jw-btn jw-btn-primary', onClick: () => void loadMonth() }, '刷新重试'))
            : null))
      } else {
        if (detailLoading) {
          body.push(h('div', { key: 'detail-loading', className: 'jw-note' }, '加载日详情…'))
        } else if (detail != null && detail.error != null) {
          body.push(h('div', { key: 'detail-error', className: 'jw-error' },
            h('div', { className: 'jw-error-title' }, '日详情加载失败'),
            h('div', null, detail.error),
            h('div', { style: { marginTop: 8 } },
              h('button', { className: 'jw-btn', onClick: () => void loadDetail(selected) }, '刷新'))))
        } else if (detail != null) {
          const collapseDetail = formOpen || generating
          if (collapseDetail) {
            body.push(h('button', {
              key: 'detail-collapse', type: 'button', className: 'jw-d-collapse',
              onClick: () => setDetailExpanded(value => !value),
            },
              h('span', null, `${detailHeadLabel(detail.date)} · 已填 ${fmtHours(detail.loggedHours)}h${detail.workday ? ` / 缺口 ${fmtHours(detail.gapHours)}h` : ''} · ${detail.tasks.length} 个任务`),
              h('span', null, detailExpanded ? '▾ 收起' : '▾ 展开')))
            if (detailExpanded) body.push(h(DayDetailBlock, { key: 'detail', detail }))
          } else {
            body.push(h(DayDetailBlock, { key: 'detail', detail }))
          }
          body.push(h(GitBlock, { key: 'git', git: detail.git, expanded: gitExpanded, onToggle: () => setGitExpanded(value => !value) }))
          // 手动素材区：引导仅缺口日出现（与生成按钮门槛同口径）；非缺口日降级呈现。
          // key 随日期重挂载——换日时在途保存回包被 aliveRef 拦截，杜绝跨日污染（终审 F-3）。
          body.push(h(NotesBlock, {
            key: `notes-${detail.date}`, api, date: detail.date,
            notes: detail.notes, notesError: detail.notesError, candidates: detail.candidates,
            guide: Boolean(detail.workday && detail.gapHours && detail.gapHours > 0),
            locked: generating || submitting,
          }))
        }
        if (generating) body.push(h('div', { key: 'genwait', className: 'jw-genwait' }, '生成中……请稍候'))
        if (notice != null) body.push(h(NoticeBox, { key: 'notice', notice, onAction: onNoticeAction }))
        if (formOpen && draft != null) {
          body.push(h('div', { key: 'form', className: 'jw-form' },
            h('div', { className: 'jw-total' },
              h('span', null, `${draft.doc.date.slice(5).replace('-', '/')} 草稿${draft.results != null ? '（已提交，可继续修改）' : ''}`),
              h('span', null, `已填 ${fmtHours(draft.doc.loggedHours)}h / 合计 ${fmtHours(totalHours)}h / 缺口 ${fmtHours(draft.doc.gapHours)}h`
                + (draft.doc.gapHours === 0 && draft.doc.loggedHours > 0 ? ' · 已填满' : ''))),
            draft.entries.length === 0
              ? h('div', { className: 'jw-none' }, '已删除全部条目；可增补条目或重新生成')
              : null,
            draft.entries.map(entry => {
              const invalid = entryInvalid(entry)
              const pending = entry.comment.trim().startsWith('待用户确认')
              const result = draft.results ? draft.results[entry.uid] : undefined
              return h('div', { key: entry.uid, className: 'jw-card' + (invalid ? ' jw-card-bad' : '') },
                h('div', { className: 'jw-card-row' },
                  h('select', {
                    className: 'jw-in', value: entry.taskId, 'aria-label': '任务',
                    onChange: e => patchEntry(entry.uid, { taskId: Number(e.target.value) }),
                  }, draft.doc.tasks.map(item => h('option', { key: item.id, value: item.id }, item.name))),
                  h('input', {
                    className: 'jw-in', value: entry.start, placeholder: 'HH:MM', 'aria-label': '开始时刻',
                    onChange: e => patchEntry(entry.uid, { start: padTimeInput(e.target.value) }),
                  }),
                  h('input', {
                    className: 'jw-in', value: entry.end, placeholder: 'HH:MM', 'aria-label': '结束时刻',
                    onChange: e => patchEntry(entry.uid, { end: padTimeInput(e.target.value) }),
                  }),
                  h('span', { className: 'jw-derived' }, entryHours(entry) != null ? `${fmtHours(entryHours(entry))}h` : '—'),
                  h('button', {
                    type: 'button', className: 'jw-del', 'aria-label': '删除条目',
                    onClick: () => removeEntry(entry.uid),
                  }, '✕')),
                h('textarea', {
                  className: 'jw-in jw-comment' + (pending ? ' jw-in-pending' : ''),
                  rows: 2, value: entry.comment, placeholder: '工作说明（一二十字）', 'aria-label': '说明',
                  title: pending ? '该说明为待确认草稿，提交前请改写' : undefined,
                  onChange: e => patchEntry(entry.uid, { comment: e.target.value }),
                }),
                invalid != null ? h('span', { className: 'jw-card-hint' }, invalid) : null,
                result != null ? h(ResultLine, { result }) : null,
                result == null && entry.lastStatus != null
                  ? h('span', { className: `jw-st jw-st-${entry.lastStatus}` },
                      entry.lastStatus === 'uncertain'
                        ? h('span', null, '⚠ 上次不确定（可能已写入）',
                            entry.issueUrl
                              ? h('a', { className: 'jw-st-link', href: entry.issueUrl, target: '_blank', rel: 'noreferrer' }, ' → 到 Jira 核对')
                              : null)
                        : '⚠ 上次失败')
                  : null,
              )
            }),
            h('button', { type: 'button', className: 'jw-add', onClick: addEntry }, '＋ 从候选任务增补条目'),
            (draft.doc.degradedNotes ?? []).map((text, index) =>
              h('div', { key: `degraded${index}`, className: 'jw-note-status' }, `⚠ ${text}`)),
            h('span', { className: 'jw-meta' }, `生成耗时 ${(draft.doc.elapsedMs / 1000).toFixed(1)}s · 条目可删除、可增补，工时由开始/结束联动计算`),
          ))
        }
      }

      const footerButtons = []
      if (generating) {
        footerButtons.push(h('button', { key: 'gen-wait', className: 'jw-btn jw-btn-primary', disabled: true }, '生成中…'))
      } else if (submitting) {
        footerButtons.push(h('button', { key: 'sub-wait', className: 'jw-btn jw-btn-primary', disabled: true }, '提交中…'))
      } else if (formOpen && draft != null) {
        const dayStillGap = month != null && month.rows.some(row => row.date === draft.doc.date && row.status === 'gap')
        footerButtons.push(h('button', { key: 'regen', className: 'jw-btn', disabled: !dayStillGap, title: dayStillGap ? undefined : '该日已无缺口', onClick: () => void onGenerate() }, '重新生成'))
        if (resubmittable) {
          footerButtons.push(h('button', { key: 'resubmit', className: 'jw-btn jw-btn-primary', onClick: () => void onSubmit(true) }, '再次提交（未成功项）'))
        } else if (draft.results == null) {
          footerButtons.push(h('button', {
            key: 'submit', className: 'jw-btn jw-btn-primary',
            disabled: anyInvalid || draft.entries.length === 0,
            title: anyInvalid ? '先修正标红的条目' : undefined,
            onClick: () => void onSubmit(false),
          }, '提交'))
        }
      } else if (!loading && failure == null) {
        footerButtons.push(h('button', { key: 'refresh', className: 'jw-btn', onClick: () => void loadMonth() }, '刷新'))
        if (canGenerate) {
          footerButtons.push(h('button', {
            key: 'generate', className: 'jw-btn jw-btn-primary',
            onClick: () => void onGenerate(),
          }, '生成日志'))
        }
      }

      return h('div', { className: 'jw-page' },
        h('header', { className: 'jw-page-head' },
          h('div', { className: 'jw-page-head-text' },
            h('h1', { className: 'jw-page-title' }, PANEL_LABEL),
            h('p', { className: 'jw-page-intro' }, '查看当月工时缺口，生成并提交 Jira 工时记录'),
          ),
        ),
        h('div', { className: 'jw-page-body' }, body),
        footerButtons.length > 0 ? h('div', { className: 'jw-page-foot' }, footerButtons) : null,
        // 查同事日志：页面最末的独立只读查询区（页脚按钮之上方为表单与页脚）——
        // 不参与 generating/submitting 锁定；置于页脚之后＝提交/重新生成按钮保持在查询区上方
        h(QueryBlock, { key: 'query-others', api }),
      )
    }

    // ---- styles ----

    // ---- settings 表单（内嵌组合包详情页 plugins.bundle.config；页头由插件页绘制）----

    // rc.1：settings 命名空间 = 行 entry id（T02 迁移后为 dsh-jira-worklogs，见 src/settings.ts）。
    const SETTINGS_NS = 'dsh-jira-worklogs'

    function settingsApi(ctx) {
      return {
        async describe() {
          return unwrap(await ctx.remote.settings.describe(), '读取配置')
        },
        /** 返回原始 RemoteResult，冲突判定（SETTINGS_CONFLICT）由调用方做。 */
        mutate(ops, revision) {
          return ctx.remote.settings.mutate(SETTINGS_NS, ops, revision)
        },
      }
    }

    function draftFromView(view) {
      const v = view?.value ?? {}
      const jira = v.jira ?? {}
      const instances = v.gitInstances && typeof v.gitInstances === 'object' ? v.gitInstances : {}
      return {
        jiraServer: jira.server ?? '',
        jiraUsername: jira.username ?? '',
        jiraPassword: '',
        jiraVerifySsl: !!jira.verifySsl,
        // 行身份：id 与可编辑的 name 解耦（saved 行以源 name 钉死、新行用序号），
        // React key 与 patchRow/removeRow 都走 id——否则在「实例名」里每敲一个字符
        // key 就变一次，整行重挂导致输入框失焦（实测 bug，2026-10-08 修复）。
        instances: Object.entries(instances).map(([name, row]) => ({
          id: `s:${name}`, name, url: row?.url ?? '', token: '', verifySsl: !!row?.verifySsl, saved: true,
        })),
        filterText: (Array.isArray(v.repoFilter) ? v.repoFilter : []).join('\n'),
      }
    }

    function buildMutateOps(draft, pristine) {
      const ops = []
      const set = (path, value) => ops.push({ op: 'set', path, value })
      if (draft.jiraServer !== pristine.jiraServer) set(['jira', 'server'], draft.jiraServer)
      if (draft.jiraUsername !== pristine.jiraUsername) set(['jira', 'username'], draft.jiraUsername)
      if (draft.jiraPassword !== '') set(['jira', 'password'], draft.jiraPassword)
      if (draft.jiraVerifySsl !== pristine.jiraVerifySsl) set(['jira', 'verifySsl'], draft.jiraVerifySsl)
      const filterLines = draft.filterText.split('\n').map(s => s.trim()).filter(Boolean)
      if (filterLines.join('\n') !== pristine.filterText.trim()) set(['repoFilter'], filterLines)
      const oldNames = new Set(pristine.instances.map(r => r.name))
      for (const row of draft.instances) {
        const isNew = !row.saved
        if (isNew) {
          set(['gitInstances', row.name], { url: row.url, token: row.token, verifySsl: row.verifySsl })
          continue
        }
        const old = pristine.instances.find(r => r.name === row.name)
        if (row.url !== old.url) set(['gitInstances', row.name, 'url'], row.url)
        if (row.token !== '') set(['gitInstances', row.name, 'token'], row.token)
        if (row.verifySsl !== old.verifySsl) set(['gitInstances', row.name, 'verifySsl'], row.verifySsl)
      }
      for (const name of oldNames) {
        if (!draft.instances.some(r => r.saved && r.name === name)) {
          ops.push({ op: 'unset', path: ['gitInstances', name] })
        }
      }
      return ops
    }

    function draftEquals(draft, pristine) {
      return buildMutateOps(draft, pristine).length === 0
    }

    function SettingsCard({ ctx }) {
      const api = settingsApi(ctx)
      const [advOpen, setAdvOpen] = useState(false)
      const [revision, setRevision] = useState(0)
      const [pristine, setPristine] = useState(null)
      const [draft, setDraft] = useState(null)
      const [saving, setSaving] = useState(false)
      const [message, setMessage] = useState(null)
      const [secretPaths, setSecretPaths] = useState([])

      // 「已配置」判定走 describe 的 secrets 记录（set=键在解析值中出现）；
      // secret 字段无 .default('')，故 set 仅在真实保存过才为真。
      const secretSet = path => {
        const key = path.join('.')
        return secretPaths.some(s => s.path.join('.') === key && s.set)
      }

      const dirty = pristine && draft && !draftEquals(draft, pristine)

      async function refresh(resetDraft = true) {
        try {
          const view = await api.describe()
          const mine = (view?.namespaces ?? []).find(n => n.ns === SETTINGS_NS)
          if (!mine) { setPristine(null); setDraft(null); return }
          setRevision(mine.revision ?? 0)
          setSecretPaths(Array.isArray(mine.secrets) ? mine.secrets : [])
          if (resetDraft) {
            const next = draftFromView(mine)
            setPristine(next)
            setDraft(next)
          } else {
            setPristine(draftFromView(mine))
          }
          setMessage(null)
        } catch (e) {
          setMessage({ kind: 'error', text: `读取配置失败：${e.message}` })
        }
      }
      useEffect(() => { refresh() }, [])

      const patch = (part) => setDraft(prev => ({ ...prev, ...part }))
      const patchRow = (id, part) => setDraft(prev => ({
        ...prev,
        instances: prev.instances.map(row => row.id === id ? { ...row, ...part } : row),
      }))
      const rowSeqRef = useRef(0)
      const addRow = () => {
        let n = draft.instances.length + 1
        let name = `实例${n}`
        while (draft.instances.some(r => r.name === name)) name = `实例${++n}`
        setDraft(prev => ({ ...prev, instances: [...prev.instances,
          { id: `n:${++rowSeqRef.current}`, name, url: '', token: '', verifySsl: false, saved: false }] }))
      }
      const removeRow = id => setDraft(prev => ({ ...prev, instances: prev.instances.filter(r => r.id !== id) }))
      const discard = () => { setDraft(pristine); setMessage(null) }

      function validateDraft() {
        for (const row of draft.instances) {
          if (!row.saved && !row.name.trim()) return '新实例的名称不能为空'
          if (!row.saved && pristine.instances.some(r => r.name === row.name.trim())) return `实例名「${row.name}」已存在`
          if (!row.url.trim()) return `实例「${row.name}」的地址不能为空`
        }
        return null
      }

      async function save() {
        if (!dirty || saving) return
        const invalid = validateDraft()
        if (invalid) { setMessage({ kind: 'error', text: invalid }); return }
        const ops = buildMutateOps(draft, pristine)
        setSaving(true)
        setMessage(null)
        try {
          const result = await api.mutate(ops, revision)
          if (result && result.ok === false) {
            const code = result.error?.code ?? ''
            const detail = `${code} ${result.error?.message ?? ''}`.trim()
            if (code === 'SETTINGS_CONFLICT' || detail.includes('changed since')) {
              await refresh(false)
              setMessage({ kind: 'error', text: '配置已被其他端修改，已重新读取，请调整后再保存' })
            } else {
              setMessage({ kind: 'error', text: `保存失败：${detail || '未知错误'}` })
            }
            return
          }
          await refresh()
        } catch (e) {
          setMessage({ kind: 'error', text: `保存失败：${e.message}` })
        } finally {
          setSaving(false)
        }
      }

      if (pristine === null && !message) return null
      const input = (value, onChange, props = {}) => h('input', {
        type: props.type ?? 'text', className: 'jw-c-input',
        value, placeholder: props.placeholder ?? '', ...props.extra,
        onChange,
      })
      const field = (label, key, props = {}) => h('div', { className: 'jw-c-field' },
        h('label', { className: 'jw-c-label' }, label),
        input(draft?.[key] ?? '', e => patch({ [key]: e.target.value }), props))
      const secretPlaceholder = configured => configured ? '已配置，留空保持不变' : '未配置'
      // 平台 Switch 同构开关（36×20 药丸 + 16px 滑块，dsw 令牌）
      const switchEl = (checked, onChange, label, title) => h('span', { className: 'jw-c-check', title },
        h('button', {
          type: 'button', role: 'switch', className: 'jw-c-switch', 'aria-checked': checked,
          'aria-label': label, onClick: () => onChange(!checked),
        }, h('span', { className: 'jw-c-thumb' })),
        h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, label))
      // 包级内嵌形态（plugins.bundle.config）：表单平铺在组合包详情页描述与组件列表之间，
      // 页头由插件页绘制；「未保存」状态由 footer 标记与按钮禁用态承载。
      return h('div', { className: 'jw-c-page' },
        h('div', { className: 'jw-c-body' },
          h('div', { className: 'jw-c-section' },
            h('div', { className: 'jw-c-section-title' }, 'Jira 连接'),
            field('地址', 'jiraServer', { placeholder: 'https://jira.example.com' }),
            field('账号', 'jiraUsername'),
            h('div', { className: 'jw-c-field' },
              h('label', { className: 'jw-c-label' }, '密码'),
              input(draft?.jiraPassword ?? '', e => patch({ jiraPassword: e.target.value }),
                { type: 'password', placeholder: secretPlaceholder(secretSet(['jira', 'password'])) })),
            h('button', { type: 'button', className: 'jw-c-adv', onClick: () => setAdvOpen(!advOpen) },
              advOpen ? '收起高级' : '高级'),
            advOpen ? switchEl(!!draft?.jiraVerifySsl, v => patch({ jiraVerifySsl: v }), '校验 SSL 证书', '关闭＝自建自签跳过') : null),
          h('div', { className: 'jw-c-section' },
            h('div', { className: 'jw-c-section-title' }, 'Git 实例'),
            (draft?.instances ?? []).map(row => h('div', { key: row.id, className: 'jw-c-row' },
              row.saved
                ? h('span', { className: 'jw-c-row-name', title: row.name }, row.name)
                : input(row.name, e => patchRow(row.id, { name: e.target.value }), { placeholder: '实例名' }),
              input(row.url, e => patchRow(row.id, { url: e.target.value }), { placeholder: 'https://gitlab.example.com' }),
              input(row.token, e => patchRow(row.id, { token: e.target.value }),
                { type: 'password', placeholder: secretPlaceholder(secretSet(['gitInstances', row.name, 'token'])) }),
              switchEl(row.verifySsl, v => patchRow(row.id, { verifySsl: v }), 'SSL', '校验 SSL 证书'),
              h('button', { type: 'button', className: 'jw-c-del', title: '删除实例', onClick: () => removeRow(row.id) }, '删除'))),
            h('button', { type: 'button', className: 'jw-c-discard', onClick: addRow, style: { alignSelf: 'flex-start' } }, '+ 添加实例')),
          h('div', { className: 'jw-c-section' },
            h('div', { className: 'jw-c-section-title' }, '仓库过滤名单'),
            h('textarea', {
              className: 'jw-c-textarea', rows: 3, value: draft?.filterText ?? '',
              placeholder: '每行一个子串，命中即排除',
              onChange: e => patch({ filterText: e.target.value }),
            })),
          h('div', { className: 'jw-c-footer' },
            message ? h('p', { className: 'jw-c-failed', role: 'status' }, message.text) : null,
            dirty && !message ? h('span', { className: 'jw-c-tag' }, '未保存') : null,
            h('button', { type: 'button', className: 'jw-c-discard', disabled: !dirty || saving, onClick: discard }, '放弃'),
            h('button', {
              type: 'button', className: 'jw-c-save', disabled: !dirty || saving, onClick: save,
            }, saving ? '保存中…' : '保存')),
        ))
    }

    const CSS = `
/* 样式层：颜色全部走 --dsw-alias-* 主题令牌（规范见仓库根 docs/DSH插件UI设计规范.md），
   几何对齐宿主原语（胶囊按钮 / 32 输入）与 PluginManagerPage 页面容器。 */
/* —— 页面容器（描摹宿主 PluginManagerPage：居中列 + 头行 + 内容；
   macOS 隐藏标题栏时头行让位帧顶安全距）—— */
.jw-page { display: flex; flex-direction: column; align-items: center; gap: 24px;
  box-sizing: border-box; height: 100%; overflow: auto;
  padding: 0 clamp(24px, 4vw, 48px) 48px;
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
.jw-page > * { width: 100%; max-width: 720px; }
.jw-page-head { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; box-sizing: border-box; padding-top: 28px; }
[data-platform='darwin'] .jw-page-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.jw-page-head-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.jw-page-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
.jw-page-intro { margin: 0; font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-secondary); }
.jw-page-body { display: flex; flex-direction: column; }
.jw-page-foot { display: flex; gap: 8px; justify-content: flex-end; padding-top: 8px; }
.jw-muted { color: var(--dsw-alias-label-tertiary); }
.jw-note { padding: 8px 10px; background: var(--dsw-alias-bg-module-platform); border-radius: 8px;
  margin-bottom: 10px; color: var(--dsw-alias-label-secondary); }
.jw-error { border: .5px solid var(--dsw-alias-border-l3); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.jw-error-title { font-weight: 600; margin-bottom: 4px; color: var(--dsw-alias-label-primary); }
.jw-git { border-top: .5px solid var(--dsw-alias-border-l2); padding: 10px 8px 2px; }
/* —— 按钮族：宿主胶囊原语（md 36/r18，变体走 --dsw-alias-button-* 令牌）—— */
.jw-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: 18px; cursor: pointer; font: inherit;
  font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); background: transparent;
  padding: 0 14px; height: 36px; }
.jw-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.jw-btn:disabled { cursor: not-allowed; opacity: .4; }
.jw-btn-primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground); }
.jw-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
/* —— 弹窗改版（月历五区）—— */
.jw-cal-title { display: flex; justify-content: space-between; align-items: center;
  color: var(--dsw-alias-label-secondary); margin-bottom: 6px; }
.jw-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 10px; }
.jw-cal-wd { text-align: center; color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; padding: 2px 0; }
.jw-day { position: relative; border: 1px solid transparent; background: none; border-radius: 6px;
  padding: 6px 0; font: inherit; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  cursor: pointer; text-align: center; }
.jw-day:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); }
.jw-day-blank { cursor: default; }
.jw-day-wknd { color: var(--dsw-alias-label-dimmed); }
.jw-day-gap { background: var(--dsw-alias-interactive-bg-hover-accent); font-weight: 600;
  color: var(--dsw-alias-label-primary); }
.jw-day-today { border-color: var(--dsw-alias-label-secondary); }
.jw-day-sel { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.jw-day-future { color: var(--dsw-alias-label-dimmed); background: var(--dsw-alias-bg-skeleton); cursor: default; }
.jw-day-locked { opacity: .55; cursor: default; }
.jw-day-dot { position: absolute; top: 1px; right: 2px; font-size: 10px; line-height: 14px;
  color: var(--dsw-alias-label-caption); font-weight: 400; }
.jw-day-dot-gap { left: 2px; right: auto; color: var(--dsw-alias-state-business-primary); }
.jw-day-dot-full { left: 2px; right: auto; color: var(--dsw-alias-state-success-primary); }
.jw-detail { border: .5px solid var(--dsw-alias-border-l3); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
.jw-detail-gap { border: 2px solid var(--dsw-alias-state-business-primary); }
.jw-d-sum { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.jw-d-date { font-weight: 600; }
.jw-d-nums { color: var(--dsw-alias-label-tertiary); }
.jw-task { border-top: .5px solid var(--dsw-alias-border-l1); padding: 6px 0 2px; }
.jw-task-name { font-weight: 500; }
.jw-entry { display: flex; gap: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px;
  line-height: 18px; margin: 2px 0; }
.jw-entry .rng, .jw-commit .rng { white-space: nowrap; }
.jw-entry .hrs { white-space: nowrap; width: 3em; }
.jw-none { color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; }
.jw-d-collapse { display: flex; justify-content: space-between; align-items: center;
  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-module-platform); border: none;
  border-radius: 8px; padding: 6px 10px; margin-bottom: 10px; cursor: pointer; width: 100%; font: inherit;
  font-size: 12px; line-height: 18px; }
.jw-git-toggle { border: none; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer;
  font: inherit; font-size: 12px; line-height: 18px; padding: 2px 0; }
.jw-git-toggle:hover { color: var(--dsw-alias-label-primary); }
/* —— 20261015 Wave：暂存提示条 —— */
.jw-outbox { border: .5px solid var(--dsw-alias-state-warn-primary); border-radius: 8px;
  padding: 8px 10px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
.jw-outbox-error { border-color: var(--dsw-alias-border-l3); }
.jw-outbox-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.jw-outbox-text { font-weight: 600; color: var(--dsw-alias-state-warn-label); }
.jw-outbox-actions { display: inline-flex; gap: 6px; }
.jw-outbox-actions .jw-btn { height: 26px; padding: 0 10px; font-size: 12px; line-height: 18px;
  border-radius: 13px; }
.jw-outbox-day { display: flex; justify-content: space-between; align-items: center; gap: 8px;
  border-top: .5px solid var(--dsw-alias-border-l1); padding-top: 6px;
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
/* —— 20261015 Wave：手动素材区 —— */
.jw-notes { border-top: .5px solid var(--dsw-alias-border-l2); padding: 10px 8px 2px;
  display: flex; flex-direction: column; gap: 6px; }
.jw-notes-head { font-weight: 500; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.jw-note { display: flex; flex-direction: column; gap: 4px; }
.jw-note-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.jw-note-text { height: auto; padding: 6px 8px; resize: vertical; line-height: 1.5; }
.jw-note-status { color: var(--dsw-alias-state-warn-label); font-size: 12px; line-height: 18px;
  display: flex; align-items: center; }
.jw-note-status .jw-btn { height: 24px; padding: 0 8px; font-size: 12px; line-height: 18px; border-radius: 12px; }
.jw-git-grp { padding-left: 12px; color: var(--dsw-alias-label-secondary); font-size: 12px;
  line-height: 18px; margin-top: 2px; }
.jw-commit { display: flex; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.jw-genwait { border: 1px dashed var(--dsw-alias-border-l4); border-radius: 8px; padding: 18px;
  text-align: center; color: var(--dsw-alias-label-tertiary); margin-bottom: 10px; }
.jw-form { display: flex; flex-direction: column; gap: 8px; }
.jw-qy { border-top: .5px solid var(--dsw-alias-border-l2); padding: 10px 8px 2px;
  display: flex; flex-direction: column; gap: 6px; }
.jw-qy-head { background: none; border: none; padding: 0; font: inherit; font-weight: 500;
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; cursor: pointer; text-align: left; }
.jw-qy-form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.jw-qy-form .jw-in { flex: 1 1 96px; min-width: 0; }
.jw-qy-result { display: flex; flex-direction: column; gap: 8px; }
.jw-qy-day { display: flex; flex-direction: column; gap: 2px; }
.jw-qy-date { font-weight: 600; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; }
.jw-qy-entry { display: flex; flex-direction: column; }
.jw-qy-entry-line { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; word-break: break-word; }
.jw-qy-comment { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px;
  padding-left: 14px; word-break: break-word; white-space: pre-wrap; }
.jw-qy-note { color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; word-break: break-word; }
.jw-qy-dwrap { position: relative; display: inline-flex; align-items: center; }
.jw-qy-dwrap .jw-in { flex: none; width: 104px; }
.jw-qy-dbtn { border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; background: none;
  color: var(--dsw-alias-label-secondary); width: 30px; height: 32px; padding: 0; font-size: 14px;
  line-height: 1; cursor: pointer; }
.jw-qy-pop { position: absolute; top: 36px; left: 0; z-index: 30; display: flex; flex-direction: column;
  gap: 6px; padding: 8px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform); }
.jw-qy-pop-head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.jw-qy-pop-nav { border: none; background: none; color: var(--dsw-alias-label-secondary);
  font-size: 14px; line-height: 18px; cursor: pointer; padding: 0 4px; }
.jw-qy-pop-grid { display: grid; grid-template-columns: repeat(7, 26px); gap: 2px; }
.jw-qy-pop-wd { color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 18px; text-align: center; }
.jw-qy-pop-blank { }
.jw-qy-pop-day { border: 1px solid transparent; background: none; border-radius: 6px; height: 24px;
  font: inherit; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary);
  cursor: pointer; text-align: center; padding: 0; }
.jw-qy-pop-day:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); }
.jw-qy-pop-today { border-color: var(--dsw-alias-label-secondary); }
.jw-qy-pop-sel { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; font-weight: 600; }
.jw-qy-pop-foot { display: flex; gap: 6px; justify-content: flex-end; }
.jw-qy-pop-act { border: none; background: none; color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; cursor: pointer; padding: 0 4px; }
.jw-qy-pop-act:hover { color: var(--dsw-alias-label-primary); }
.jw-total { display: flex; justify-content: space-between; color: var(--dsw-alias-label-secondary); }
.jw-card { border: .5px solid var(--dsw-alias-border-l3); border-radius: 8px; padding: 8px 10px; display: flex;
  flex-direction: column; gap: 6px; }
.jw-card-row { display: grid; grid-template-columns: minmax(0, 1fr) 62px 62px auto auto; gap: 8px; align-items: center; }
.jw-card-bad { border-color: var(--dsw-alias-state-warn-primary); }
.jw-in { border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 0 8px; font: inherit;
  font-size: 13px; line-height: 20px; height: 32px; width: 100%; box-sizing: border-box;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.jw-in:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
select.jw-in { padding: 0 4px; }
textarea.jw-in { height: auto; padding: 6px 8px; }
.jw-in-pending { border-color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-state-warn-tertiary); }
.jw-comment { resize: vertical; line-height: 1.5; }
.jw-card-hint { color: var(--dsw-alias-state-warn-label); font-size: 12px; line-height: 18px; }
.jw-derived { color: var(--dsw-alias-label-secondary); white-space: nowrap; font-size: 12px;
  line-height: 18px; text-align: center; }
.jw-del { border: none; background: none; color: var(--dsw-alias-label-caption); cursor: pointer;
  font-size: 13px; padding: 4px; border-radius: 6px; }
.jw-del:hover { color: var(--dsw-alias-state-error-primary); }
.jw-add { align-self: flex-start; border: 1px dashed var(--dsw-alias-border-l4); background: none; border-radius: 8px;
  padding: 5px 10px; font: inherit; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  cursor: pointer; }
.jw-add:hover { color: var(--dsw-alias-label-primary); }
.jw-meta { color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; }
.jw-st { font-size: 12px; line-height: 18px; }
.jw-st-written { color: var(--dsw-alias-state-success-primary); }
.jw-st-skipped { color: var(--dsw-alias-label-tertiary); }
.jw-st-uncertain, .jw-st-failed { color: var(--dsw-alias-state-warn-label); font-weight: 600; }
.jw-st-link { color: inherit; margin-left: 6px; font-weight: 400; text-decoration: underline; }
/* 键盘焦点：按钮类 outline 2px，输入类 border 变色（宿主原语惯例） */
.jw-page button:focus-visible, .jw-page [role='switch']:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
/* 包级内嵌表单（plugins.bundle.config，位于组合包详情页）：规格与平台设置页 / SettingsField / Tag / Switch 同源
   （dsw-alias-* 为页面级设计令牌，值取自官方样式表）。 */
.jw-c-page { display: flex; flex-direction: column; }
.jw-c-body { border-top: .5px solid var(--dsw-alias-border-l2); padding-bottom: 8px; }
.jw-c-tag { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px;
  font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; flex: none;
  background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.jw-c-footer { border-top: .5px solid var(--dsw-alias-border-l2); justify-content: flex-end; align-items: center;
  gap: 8px; padding: 12px 0 4px; display: flex; }
.jw-c-failed { min-width: 0; color: var(--dsw-alias-label-error); flex: 1; margin: 0; font-size: 12px; line-height: 1.5; text-align: left; }
.jw-c-discard, .jw-c-save { appearance: none; font: inherit; cursor: pointer; border: 1px solid transparent;
  border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5; }
.jw-c-discard { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: none; }
.jw-c-discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
.jw-c-save { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.jw-c-discard:disabled, .jw-c-save:disabled { opacity: .4; cursor: default; }
.jw-c-discard:focus-visible, .jw-c-save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.jw-c-section { color: var(--dsw-alias-label-primary); flex-direction: column; display: flex; padding-top: 12px; }
.jw-c-section-title { color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 500; line-height: 1.5;
  padding: 4px 0; }
.jw-c-field { flex-direction: column; gap: 6px; display: flex; padding: 6px 0; }
.jw-c-label { min-width: 0; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 1.5; }
.jw-c-input { border: .5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-3); height: 34px;
  font: inherit; color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 0 12px; font-size: 13px;
  line-height: 1.5; width: 100%; box-sizing: border-box; }
.jw-c-input:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
.jw-c-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.jw-c-textarea { border: .5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-3);
  font: inherit; color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 8px 12px; font-size: 13px;
  line-height: 1.5; width: 100%; box-sizing: border-box; }
.jw-c-textarea:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
.jw-c-row { display: grid; grid-template-columns: 110px 1fr 1fr auto auto; gap: 8px; align-items: center; padding: 6px 0; }
.jw-c-row-name { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.jw-c-adv { font: inherit; color: var(--dsw-alias-label-secondary); cursor: pointer; background: none; border: none;
  padding: 0; font-size: 12px; line-height: 1.5; }
.jw-c-adv:hover { color: var(--dsw-alias-label-primary); }
.jw-c-check { display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-primary);
  font-size: 13px; line-height: 1.5; }
.jw-c-switch { box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px;
  border: 0; border-radius: 10px; corner-shape: round; background: var(--dsw-alias-border-l3); cursor: pointer; }
.jw-c-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.jw-c-switch:disabled { cursor: default; opacity: .5; }
.jw-c-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.jw-c-thumb { display: block; width: 16px; height: 16px; border-radius: 50%; corner-shape: round;
  background: var(--dsw-alias-label-primary-foreground); transition: transform .12s; }
.jw-c-switch[aria-checked="true"] .jw-c-thumb { transform: translate(16px); }
.jw-c-chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px; font-size: 11px;
  line-height: 17px; font-weight: 500; white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.jw-c-chip-ok { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary); }
.jw-c-del { appearance: none; font: inherit; cursor: pointer; border: 1px solid transparent; border-radius: 8px;
  padding: 5px 10px; font-size: 13px; line-height: 1.5; border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary); background: none; }
.jw-c-del:hover { color: var(--dsw-alias-label-error); border-color: var(--dsw-alias-label-dimmed); }
`

    const styleEl = document.createElement('style')
    styleEl.textContent = CSS
    document.head.append(styleEl)

    return {
      inject: ['slots', 'remote'],
      async apply(ctx) {
        ctx.inject(['remote.settings'], sctx => {
          sctx.slots.inject('plugins.bundle.config', () => sctx.slots.register(
            { name: 'plugins.bundle.config', key: '@westwall/dsh-jira-worklogs' },
            () => h(SettingsCard, { ctx: sctx }),
          ))
        })
        // 两段式（同 agent-team 客户端范例）：先挂载本包 remote 命名空间，
        // 再以内层 ctx 注入 remote.jiraWorklogs 并注册 UI——
        // 追踪服务的属性访问要求在注入声明之内。
        try {
          await ctx.remote.$mount(JIRA_WORKLOGS_CONTRIBUTION)
        } catch (error) {
          console.error('[dsh-jira-worklogs] remote mount failed:', error)
          return
        }
        ctx.inject(['remote.jiraWorklogs'], uiCtx => {
          // 主栏页面：main 键控槽自有 key（非 conversation key 无会话绑定，
          // 点菜单行即切入本页——同「插件」「任务」全局面板语义）。
          uiCtx.slots.inject('main', () => uiCtx.slots.register(
            { name: 'main', key: PANEL_ID },
            () => h(JiraWorklogsPage, { ctx: uiCtx }),
          ))
          // 侧栏菜单行：order 落在「插件」（ui-plugin-manager order 0）与
          //「任务」（ui-schedule order 10）之间，渲染于工作区列表之上
          //（SidebarRoot：面板行 nav → sidebar.workspaces 浏览区）。
          uiCtx.slots.inject('sidebar.panellist', () => uiCtx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => PANEL_LABEL },
            ({ size }) => h(JiraPanelIcon, { size }),
          ))
        })
      },
    }
  },
})
