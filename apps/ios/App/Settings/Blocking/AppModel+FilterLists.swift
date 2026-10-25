import ArdiaBrowser

extension AppModel {
  var filterLists: FilterLists { blocker.filterLists }
}

extension FilterLists {
  var enabledLists: [FilterListInfo] { lists.filter(\.isEnabled) }
  var customListCount: Int { lists.filter(\.isCustom).count }
}
