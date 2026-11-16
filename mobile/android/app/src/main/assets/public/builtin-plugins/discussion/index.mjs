// 发帖子：帖子页面（楼层、楼中楼、图片、格式）由墨页的帖子服务提供，这个插件负责入口和分类。
const isPost = d => d.kind === 'discussion';
export function activate(host) {
  const create = () => host.services.newPost();
  host.docTypes.register({ id: 'discussion', label: '帖子', icon: 'post', iconClass: 'post', match: isPost });
  host.library.addCategory({ id: 'discussion', title: '帖子与评论', icon: 'post', order: 40, match: isPost, newCard: { title: '新建帖子', subtitle: '主楼 · 日期时间 · 楼中楼', run: create } });
  host.library.addTile({ id: 'post', title: '发帖子', subtitle: '多楼层逐层回复', icon: 'post', className: 'tile-post', order: 40, run: create });
  host.library.addNewMenuItem({ id: 'discussion', title: '帖子', subtitle: '一页一个帖子，可连发多个楼层并逐层回复', icon: 'post', tone: 'tertiary', order: 40, run: create });
}
