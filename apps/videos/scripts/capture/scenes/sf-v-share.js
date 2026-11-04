then(() => SF.shareFolder(W, folder().id).then(() => sleep(1500)).then(() => picShown()).then(() => rows()).then((r) => snap("shared", { rows: r })));
return finish({ links: linksOf(folder()) });
