package com.ardia.browser

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReadableContentTest {
    private val harness = PageHarness()

    @After
    fun tearDown() = harness.close()

    private fun extract(html: String, path: String): ReadableContent {
        harness.server.page(path, html)
        val page = harness.open(path, path)
        harness.await(page.state) { !it.isLoading && it.title.isNotEmpty() }
        return harness.onMainSuspending { page.readableContent() }
    }

    private fun expectClean(content: ReadableContent) {
        val text = content.text
        assertFalse("CSS leaked into ${content.title}", text.contains("{"))
        assertFalse(text.contains("mw-parser-output"))
        assertFalse("reference markers in ${content.title}", Regex("\\[\\d+]").containsMatchIn(text))
        assertFalse(content.paragraphs.any { it == content.title || it == "• " + content.title })
    }

    private fun assertNoneContain(content: ReadableContent, junk: List<String>) {
        for (word in junk) assertFalse("$word leaked", content.paragraphs.any { it.contains(word) })
    }

    @Test
    fun wikipediaKeepsTheArticleAndDropsTheChrome() {
        val content = extract(ReaderFixtures.wikipedia, "/wiki/Sintra")
        expectClean(content)
        assertEquals("Sintra", content.title)
        assertTrue(content.paragraphs.first().startsWith("Sintra (/ˈsɪntrə/) is a town in the Greater Lisbon region of Portugal. It is known"))
        assertTrue(content.paragraphs.contains("History"))
        assertTrue(content.paragraphs.contains("Geography"))
        for (junk in listOf("Article", "Talk", "• Article", "• Talk", "edit", "Contents", "Municipality", "For other uses", "Privacy policy", "Watch", "citation needed", "Instituto")) {
            assertFalse("$junk leaked", content.paragraphs.any { it == junk || (it.contains(junk) && junk.length > 6) })
        }
        assertTrue(content.isArticle)
        assertEquals("en", content.language)
    }

    @Test
    fun newsArticleKeepsBodyAndSubheadings() {
        val content = extract(ReaderFixtures.news, "/news/articles/x")
        expectClean(content)
        assertEquals("Storm brings floods to coastal towns", content.title)
        assertEquals("BBC News", content.siteName)
        assertEquals("Jane Reporter", content.byline)
        assertEquals("https://ichef.example/storm.jpg", content.leadImage)
        assertTrue(content.paragraphs.first().startsWith("Hundreds of homes"))
        assertTrue(content.paragraphs.contains("Rescue teams"))
        assertNoneContain(content, listOf("Home", "Sport", "Flooding", "Share", "Another headline", "Copyright"))
    }

    @Test
    fun recipeKeepsTheStoryIngredientsAndSteps() {
        val content = extract(ReaderFixtures.recipe, "/banana-bread")
        expectClean(content)
        assertEquals("Best Banana Bread", content.title)
        assertTrue(content.paragraphs.contains("• 3 ripe bananas"))
        assertTrue(content.paragraphs.contains("• Bake for 60 minutes."))
        assertEquals(1, content.paragraphs.count { it.contains("3 ripe bananas") })
        assertNoneContain(content, listOf("Jump to Recipe", "Print Recipe", "Advertisement", "Comments", "Loved it", "Recipes", "About"))
        assertTrue(content.isArticle)
    }

    @Test
    fun recipeSchemaFillsInWhenThePageHidesTheCard() {
        val hidden = ReaderFixtures.recipe.replace(
            "<div class=\"wprm-recipe-container\" id=\"recipe\">",
            "<div class=\"wprm-recipe-container\" id=\"recipe\" style=\"display:none\">",
        )
        val content = extract(hidden, "/banana-bread-hidden")
        assertTrue(content.paragraphs.contains("Ingredients"))
        assertTrue(content.paragraphs.contains("• 2 cups flour"))
        assertTrue(content.paragraphs.contains("2. Mash the bananas and mix everything."))
    }

    @Test
    fun blogKeepsThePostAndDropsSidebarAndFooter() {
        val content = extract(ReaderFixtures.blog, "/plain-text")
        expectClean(content)
        assertEquals("Why I Moved My Notes to Plain Text", content.title)
        assertTrue(content.paragraphs.contains("Files outlive formats, and formats outlive apps."))
        assertTrue(content.paragraphs.any { it.startsWith("For ten years") })
        assertNoneContain(content, listOf("Archive", "Tweet", "Popular posts", "Subscribe", "Made with care", "smartphone"))
    }

    @Test
    fun aDiscardedPageHasNothingToRead() {
        val limited = PageHarness(liveLimit = 1)
        try {
            limited.server.page("/a", "<title>A</title>")
            limited.server.page("/b", "<title>B</title>")
            val first = limited.open("first", "/a")
            limited.awaitTitle(first, "A")
            limited.open("second", "/b")
            try {
                limited.onMainSuspending { first.readableContent() }
                fail("A page without a live view should not be readable")
            } catch (error: ReadableContentException) {
                assertEquals(ReadableContentException.Reason.PageNotLoaded, error.reason)
            }
        } finally {
            limited.close()
        }
    }
}
