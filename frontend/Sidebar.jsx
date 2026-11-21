import { ActionIcon, Box, Divider, NavLink, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { IconLayoutDashboard, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconPlus } from '@tabler/icons-react';
import { byUrgency, fieldHref } from './model.js';
import { statusColor, statusShort } from './ui.jsx';

function Dot({ water, letter }) {
  const color = `var(--mantine-color-${statusColor(water)}-6)`;
  return letter
    ? <span className="field-avatar" style={{ borderColor: color }}>{letter}<i style={{ background: color }}/></span>
    : <span className="status-dot" style={{ background: color }}/>;
}

/** Nawigacja: pulpit, dodawanie pola i pola posortowane od najpilniejszego. `compact`: same ikony. */
export function Sidebar({ fields, currentId, page, compact, onToggle, onNavigate, preview }) {
  const item = (props, tip) => (compact
    ? <Tooltip label={tip} position="right" withArrow key={props.key}><NavLink {...props} label={null} description={null} className="nav-compact"/></Tooltip>
    : <NavLink {...props}/>);
  const fieldsSorted = byUrgency(fields);
  return <Stack h="100%" gap={4}>
    {item({ key: 'dash', component: 'a', href: '#', label: 'Pulpit', leftSection: <IconLayoutDashboard size={20}/>,
      active: page === 'dashboard', onClick: onNavigate }, 'Pulpit')}
    {item({ key: 'add', component: 'a', href: '#dodaj', label: 'Dodaj pole', leftSection: <IconPlus size={20}/>,
      active: page === 'add', onClick: onNavigate }, 'Dodaj pole')}
    <Divider my="sm"/>
    {!compact && <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={.6} px="sm" mb={4}>Moje pola</Text>}
    <ScrollArea flex={1} type="auto" offsetScrollbars>
      <Stack gap={2}>
        {preview && item({ key: 'preview', component: 'a', href: '#podglad', label: preview.name, description: 'podgląd z linku',
          leftSection: <Dot water={preview.report.water_status} letter={compact ? preview.name[0] : null}/>,
          active: currentId === 'preview', onClick: onNavigate }, `${preview.name} (podgląd)`)}
        {fieldsSorted.map((field) => {
          const water = field.report.water_status;
          const status = statusShort(water);
          return item({ key: field.id, component: 'a', href: fieldHref(field.id), label: field.name,
            description: `${field.report.crop.name} · ${status}`, onClick: onNavigate,
            leftSection: <Dot water={water} letter={compact ? field.name.replace(/^Działka\s*/, '')[0]?.toUpperCase() : null}/>,
            active: currentId === field.id }, `${field.name}: ${status}`);
        })}
        {!fields.length && !compact && <Text size="sm" c="dimmed" px="sm">Nie masz jeszcze zapisanych pól.</Text>}
      </Stack>
    </ScrollArea>
    <Box visibleFrom="sm" pt="xs" className="sidebar-foot">
      <Tooltip label={compact ? 'Rozwiń menu' : 'Zwiń menu'} position="right" withArrow>
        <ActionIcon variant="subtle" color="gray" size="lg" onClick={onToggle} aria-label={compact ? 'Rozwiń menu' : 'Zwiń menu'}>
          {compact ? <IconLayoutSidebarLeftExpand size={20}/> : <IconLayoutSidebarLeftCollapse size={20}/>}
        </ActionIcon>
      </Tooltip>
    </Box>
  </Stack>;
}
