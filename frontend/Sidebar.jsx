import { ActionIcon, Box, NavLink, Stack, Tooltip } from '@mantine/core';
import { IconLayoutDashboard, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconPlus } from '@tabler/icons-react';

/** Nawigacja: pulpit i dodawanie pola (modal). `compact`: same ikony. */
export function Sidebar({ page, compact, onToggle, onNavigate, onAdd }) {
  const item = (props, tip) => (compact
    ? <Tooltip label={tip} position="right" withArrow key={props.key}><NavLink {...props} label={null} className="nav-compact"/></Tooltip>
    : <NavLink {...props}/>);
  return <Stack h="100%" gap={4}>
    {item({ key: 'dash', component: 'a', href: '#', label: 'Pulpit', leftSection: <IconLayoutDashboard size={20}/>,
      active: page === 'dashboard', onClick: onNavigate }, 'Pulpit')}
    {item({ key: 'add', label: 'Dodaj pole', leftSection: <IconPlus size={20}/>, onClick: () => { onNavigate(); onAdd(); } }, 'Dodaj pole')}
    <Box flex={1}/>
    <Box visibleFrom="sm" pt="xs" className="sidebar-foot">
      <Tooltip label={compact ? 'Rozwiń menu' : 'Zwiń menu'} position="right" withArrow>
        <ActionIcon variant="subtle" color="gray" size="lg" onClick={onToggle} aria-label={compact ? 'Rozwiń menu' : 'Zwiń menu'}>
          {compact ? <IconLayoutSidebarLeftExpand size={20}/> : <IconLayoutSidebarLeftCollapse size={20}/>}
        </ActionIcon>
      </Tooltip>
    </Box>
  </Stack>;
}
