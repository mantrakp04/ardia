let head;
then(() => picShown().then(() => row(folder().id)).then((r) => { head = r; return snap("rest", { head: r }); }));
then(() => ac.shell.devSetPointer(W, { x: head.x + 90, y: head.y + head.height / 2 }).then(() => sleep(400)).then(() => snap("hover", { head, ptr: [head.x + 90, head.y + head.height / 2] })));
then(() => { slow(5); return Promise.all([GM.openGroupMenu(W, folder().id), snapFor("sharing", 4000)]); });
then(() => { slow(1); return ac.shell.devSetPointer(W, null).then(() => sleep(600)).then(() => row(folder().id)).then((r) => snap("shared", { head: r })); });
return finish({ head, links: linksOf(folder()) });
